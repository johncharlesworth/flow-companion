// Google Gemini adapter (Google rules). The key travels in
// the x-goog-api-key header, never the URL. No explicit cachedContents:
// implicit caching is the provider's own, best effort.

import { classifyByStatus, type ErrorBody, streamRequest } from './http';
import { parseJsonSse } from './sse';
import type { ChatError, Chunk, LLMProvider, SendArgs, StopReason, Usage } from './types';

export const GOOGLE_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export interface GoogleRequestBody {
  systemInstruction: { parts: { text: string }[] };
  contents: { role: 'user' | 'model'; parts: { text: string }[] }[];
  generationConfig: { maxOutputTokens: number; thinkingConfig?: { thinkingLevel: string } };
}

function googleEndpoint(modelId: string): string {
  return `${GOOGLE_BASE}/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`;
}

/** The first user turn is the wrapped flow, a blank line, then the first question (the cache prefix). */
export function buildGoogleRequest(args: Omit<SendArgs, 'apiKey' | 'signal'>): GoogleRequestBody {
  const contents: GoogleRequestBody['contents'] = [];
  let first = true;
  for (const turn of args.messages) {
    if (first && turn.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: `${args.wrappedFlow}\n\n${turn.content}` }] });
      first = false;
      continue;
    }
    contents.push({ role: turn.role === 'assistant' ? 'model' : 'user', parts: [{ text: turn.content }] });
  }
  const body: GoogleRequestBody = {
    systemInstruction: { parts: [{ text: args.system }] },
    contents,
    generationConfig: { maxOutputTokens: args.maxOutputTokens },
  };
  if (args.model.family === 'google-3' && args.effort) body.generationConfig.thinkingConfig = { thinkingLevel: args.effort };
  return body;
}

export function classifyGoogleError(body: ErrorBody): ChatError {
  const { status, code, message } = body;
  const text = `${code} ${message}`;
  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(text)) return { class: 'keyRejected', status };
  if (status === 403) return { class: 'keyRejected', status };
  if (status === 429 && /free tier|free_tier|billing/i.test(text)) return { class: 'noCredit', status };
  if (status === 400 && /token count|input token|exceeds the maximum|too large/i.test(text)) return { class: 'requestTooLarge', status };
  return classifyByStatus(status) ?? { class: 'unknown', status };
}

function stopReason(raw: string | null | undefined): StopReason {
  if (raw === 'MAX_TOKENS') return 'max_tokens';
  if (raw === 'SAFETY' || raw === 'RECITATION' || raw === 'BLOCKLIST' || raw === 'PROHIBITED_CONTENT' || raw === 'SPII') return 'refusal';
  return 'end';
}

interface GoogleEvent {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number; thoughtsTokenCount?: number };
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
}

export class GoogleProvider implements LLMProvider {
  constructor(private readonly fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  send(args: SendArgs): AsyncGenerator<Chunk> {
    const body = buildGoogleRequest(args);
    const request = () =>
      this.fetchImpl(googleEndpoint(args.model.id), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': args.apiKey },
        body: JSON.stringify(body),
        signal: args.signal,
      });
    return streamRequest(request, classifyGoogleError, consume, args.signal);
  }
}

async function* consume(stream: ReadableStream<Uint8Array>): AsyncGenerator<Chunk> {
  let usage: Usage | null = null;
  let reason: StopReason | null = null;
  for await (const ev of parseJsonSse<GoogleEvent>(stream)) {
    if (ev.error) {
      yield { type: 'error', error: { class: 'interrupted' } };
      return;
    }
    if (ev.promptFeedback?.blockReason) reason = 'refusal';
    const candidate = ev.candidates?.[0];
    for (const part of candidate?.content?.parts ?? []) {
      if (part.thought) continue;
      if (typeof part.text === 'string' && part.text.length > 0) yield { type: 'text', text: part.text };
    }
    if (candidate?.finishReason) reason = stopReason(candidate.finishReason);
    if (ev.usageMetadata) {
      usage = {
        inputTokens: ev.usageMetadata.promptTokenCount ?? 0,
        cachedInputTokens: ev.usageMetadata.cachedContentTokenCount ?? 0,
        cacheWriteTokens: 0,
        outputTokens: ev.usageMetadata.candidatesTokenCount ?? 0,
        reasoningTokens: ev.usageMetadata.thoughtsTokenCount ?? 0,
      };
    }
  }
  if (usage) yield { type: 'usage', usage };
  if (reason) yield { type: 'stop', reason };
  else yield { type: 'error', error: { class: 'interrupted' } };
}
