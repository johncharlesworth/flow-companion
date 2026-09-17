// OpenAI Chat Completions adapter (OpenAI rules).
// Chat Completions for v1.0; the Responses API is the v1.1 migration.

import { classifyByStatus, type ErrorBody, streamRequest } from './http';
import { parseJsonSse } from './sse';
import type { ChatError, Chunk, LLMProvider, SendArgs, StopReason, Usage } from './types';

export const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

export interface OpenAiRequestBody {
  model: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  max_completion_tokens: number;
  stream: true;
  stream_options: { include_usage: true };
  reasoning_effort?: string;
}

/** The first user message is the wrapped flow, a blank line, then the first question (the cache prefix). */
export function buildOpenAiRequest(args: Omit<SendArgs, 'apiKey' | 'signal'>): OpenAiRequestBody {
  const messages: OpenAiRequestBody['messages'] = [{ role: 'system', content: args.system }];
  let first = true;
  for (const turn of args.messages) {
    if (first && turn.role === 'user') {
      messages.push({ role: 'user', content: `${args.wrappedFlow}\n\n${turn.content}` });
      first = false;
      continue;
    }
    messages.push({ role: turn.role, content: turn.content });
  }
  const body: OpenAiRequestBody = {
    model: args.model.id,
    messages,
    max_completion_tokens: args.maxOutputTokens,
    stream: true,
    stream_options: { include_usage: true },
  };
  if ((args.model.family === 'openai-5.6' || args.model.family === 'openai-5') && args.effort) body.reasoning_effort = args.effort;
  return body;
}

export function classifyOpenAiError(body: ErrorBody): ChatError {
  const { status, code, message } = body;
  if (status === 429 && /insufficient_quota/i.test(code)) return { class: 'noCredit', status };
  if (status === 400 && /context_length_exceeded|maximum context length|too many tokens/i.test(`${code} ${message}`)) return { class: 'requestTooLarge', status };
  if (status === 403) return { class: 'keyRejected', status };
  return classifyByStatus(status) ?? { class: 'unknown', status };
}

function stopReason(raw: string | null | undefined): StopReason {
  if (raw === 'length') return 'max_tokens';
  if (raw === 'content_filter') return 'refusal';
  return 'end';
}

interface OpenAiEvent {
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  } | null;
  error?: { message?: string };
}

export class OpenAiProvider implements LLMProvider {
  constructor(private readonly fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  send(args: SendArgs): AsyncGenerator<Chunk> {
    const body = buildOpenAiRequest(args);
    const request = () =>
      this.fetchImpl(OPENAI_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${args.apiKey}` },
        body: JSON.stringify(body),
        signal: args.signal,
      });
    return streamRequest(request, classifyOpenAiError, consume, args.signal);
  }
}

async function* consume(stream: ReadableStream<Uint8Array>): AsyncGenerator<Chunk> {
  let usage: Usage | null = null;
  let reason: StopReason = 'end';
  let finished = false;
  for await (const ev of parseJsonSse<OpenAiEvent>(stream, (data) => data === '[DONE]')) {
    if (ev.error) {
      yield { type: 'error', error: { class: 'interrupted' } };
      return;
    }
    const choice = ev.choices?.[0];
    const text = choice?.delta?.content;
    if (typeof text === 'string' && text.length > 0) yield { type: 'text', text };
    if (choice?.finish_reason) {
      reason = stopReason(choice.finish_reason);
      finished = true;
    }
    if (ev.usage) {
      const cached = ev.usage.prompt_tokens_details?.cached_tokens ?? 0;
      usage = {
        inputTokens: ev.usage.prompt_tokens ?? 0,
        cachedInputTokens: cached,
        cacheWriteTokens: 0,
        outputTokens: ev.usage.completion_tokens ?? 0,
        reasoningTokens: ev.usage.completion_tokens_details?.reasoning_tokens ?? 0,
      };
    }
  }
  if (usage) yield { type: 'usage', usage };
  if (finished) yield { type: 'stop', reason };
  else yield { type: 'error', error: { class: 'interrupted' } };
}
