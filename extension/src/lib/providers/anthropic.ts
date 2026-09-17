// Anthropic Messages API adapter (Anthropic rules).
// Hand-rolled fetch: no SDK, no retries (invariant 1).

import { classifyByStatus, type ErrorBody, streamRequest } from './http';
import { parseJsonSse } from './sse';
import type { ChatError, Chunk, LLMProvider, SendArgs, StopReason, Usage } from './types';

export const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

type Block = { type: 'text'; text: string };
type Message = { role: 'user' | 'assistant'; content: string | Block[] };

export interface AnthropicRequestBody {
  model: string;
  system: string;
  max_tokens: number;
  stream: true;
  /** Automatic prompt caching, one top-level marker, one-hour lifetime. */
  cache_control?: { type: 'ephemeral'; ttl: '1h' };
  output_config?: { effort: string };
  messages: Message[];
}

/**
 * The first user message is two text blocks, the wrapped flow then the first
 * question, byte-identical on every turn (it is the cache prefix). Later turns
 * are plain strings. Sampling parameters and `thinking` are never sent.
 */
export function buildAnthropicRequest(args: Omit<SendArgs, 'apiKey' | 'signal'>): AnthropicRequestBody {
  const messages: Message[] = [];
  let first = true;
  for (const turn of args.messages) {
    if (first && turn.role === 'user') {
      messages.push({ role: 'user', content: [{ type: 'text', text: args.wrappedFlow }, { type: 'text', text: turn.content }] });
      first = false;
      continue;
    }
    messages.push({ role: turn.role, content: turn.content });
  }
  const body: AnthropicRequestBody = {
    model: args.model.id,
    system: args.system,
    max_tokens: args.maxOutputTokens,
    stream: true,
    cache_control: { type: 'ephemeral', ttl: '1h' },
    messages,
  };
  if (args.model.family === 'anthropic-5' && args.effort) body.output_config = { effort: args.effort };
  return body;
}

export function classifyAnthropicError(body: ErrorBody): ChatError {
  const { status, message } = body;
  if (status === 400 && /credit balance|billing|purchase credits/i.test(message)) return { class: 'noCredit', status };
  if (status === 400 && /prompt is too long|too many tokens|exceeds the maximum|context window/i.test(message)) return { class: 'requestTooLarge', status };
  if (status === 403) return { class: 'keyRejected', status };
  return classifyByStatus(status) ?? { class: 'unknown', status };
}

function stopReason(raw: string | null | undefined): StopReason {
  if (raw === 'max_tokens') return 'max_tokens';
  if (raw === 'refusal') return 'refusal';
  return 'end';
}

interface AnthropicEvent {
  type: string;
  message?: { usage?: { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; output_tokens?: number } };
  delta?: { type?: string; text?: string; stop_reason?: string | null };
  usage?: { output_tokens?: number; input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  error?: { type?: string; message?: string };
}

export class AnthropicProvider implements LLMProvider {
  constructor(private readonly fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  send(args: SendArgs): AsyncGenerator<Chunk> {
    const body = buildAnthropicRequest(args);
    const request = () =>
      this.fetchImpl(ANTHROPIC_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': args.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          // The standard opt-in for bring-your-own-key extensions.
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
        signal: args.signal,
      });
    return streamRequest(request, classifyAnthropicError, consume, args.signal);
  }
}

async function* consume(stream: ReadableStream<Uint8Array>): AsyncGenerator<Chunk> {
  let usage: Usage = { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0 };
  let reason: StopReason = 'end';
  for await (const ev of parseJsonSse<AnthropicEvent>(stream)) {
    switch (ev.type) {
      case 'message_start': {
        const u = ev.message?.usage ?? {};
        const read = u.cache_read_input_tokens ?? 0;
        const write = u.cache_creation_input_tokens ?? 0;
        usage = { ...usage, inputTokens: (u.input_tokens ?? 0) + read + write, cachedInputTokens: read, cacheWriteTokens: write };
        break;
      }
      case 'content_block_delta':
        if (ev.delta?.type === 'text_delta' && typeof ev.delta.text === 'string') yield { type: 'text', text: ev.delta.text };
        break;
      case 'message_delta':
        if (ev.usage?.output_tokens !== undefined) usage = { ...usage, outputTokens: ev.usage.output_tokens };
        if (ev.delta?.stop_reason) reason = stopReason(ev.delta.stop_reason);
        break;
      case 'message_stop':
        yield { type: 'usage', usage };
        yield { type: 'stop', reason };
        return;
      case 'error':
        yield { type: 'error', error: { class: /overloaded/i.test(ev.error?.type ?? '') ? 'providerBusy' : 'interrupted' } };
        return;
      default:
        break;
    }
  }
  // The stream ended without message_stop: report what we have.
  yield { type: 'usage', usage };
  yield { type: 'error', error: { class: 'interrupted' } };
}

