// Provider-agnostic contract for the three hand-rolled adapters. The canonical
// message shape is a system string plus alternating user/assistant turns; the
// flow block is injected into the first user turn by each adapter at send time
// (prompt layout), so history never stores it.

import type { RequestFamily } from '@/lib/models';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Normalised from each provider's own usage report. */
export interface Usage {
  /** Total input tokens for the turn, cached ones included ("sent"). */
  inputTokens: number;
  /** Input tokens served from the provider's cache ("reused"). */
  cachedInputTokens: number;
  /** Tokens written to the cache this turn (Anthropic reports these; others 0). */
  cacheWriteTokens: number;
  /** Output tokens ("in the answer"). */
  outputTokens: number;
  /** Hidden reasoning tokens, when the provider reports them. */
  reasoningTokens: number;
}

export type StopReason = 'end' | 'max_tokens' | 'refusal';

/** The error classes. Raw provider text never travels with them. */
export type ChatErrorClass =
  | 'keyRejected'
  | 'noCredit'
  | 'rateLimit'
  | 'modelUnavailable'
  | 'providerBusy'
  | 'requestTooLarge'
  | 'interrupted'
  | 'unknown';

export interface ChatError {
  class: ChatErrorClass;
  status?: number;
}

export type Chunk =
  | { type: 'text'; text: string }
  | { type: 'usage'; usage: Usage }
  | { type: 'stop'; reason: StopReason }
  | { type: 'error'; error: ChatError };

export interface SendArgs {
  apiKey: string;
  model: { id: string; family: RequestFamily };
  system: string;
  /** The flow JSON already wrapped (flow-wrapper.ts). */
  wrappedFlow: string;
  /**
   * The conversation, oldest first, ending with the new user turn. The first
   * user message is the first question only; the adapter prepends the flow.
   */
  messages: ChatMessage[];
  maxOutputTokens: number;
  /** The provider's own effort value from models.effortFor, or null. */
  effort: string | null;
  /** Stop, or navigation away. The adapter yields nothing after an abort. */
  signal: AbortSignal;
}

export interface LLMProvider {
  /** Never retries on its own (invariant 1). */
  send(args: SendArgs): AsyncIterable<Chunk>;
}
