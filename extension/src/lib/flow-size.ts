// The size story: how big the flow is in tokens, said in
// words; whether an answer reused the flow; when a chat is getting long; and
// the one place numbers appear, the chip's hover line. Nothing here is ever
// shown as a number except through hoverSummary and hoverRows (the flow chip).

import { type ProviderId, providerName } from './models';

export type SizeWord = 'small' | 'medium' | 'large' | 'very large';

/** Size thresholds, internal only; nothing in the UI shows a size word or a number. */
export const SIZE_THRESHOLDS = { small: 50_000, medium: 150_000, large: 400_000 } as const;

export function sizeWord(tokens: number): SizeWord {
  if (tokens < SIZE_THRESHOLDS.small) return 'small';
  if (tokens < SIZE_THRESHOLDS.medium) return 'medium';
  if (tokens < SIZE_THRESHOLDS.large) return 'large';
  return 'very large';
}

/** Characters per token, conservative against the Phase 5 corpus; Anthropic's is its own rule of thumb for the 4.7+ tokenizer. */
export const CHARS_PER_TOKEN: Record<ProviderId, number> = { anthropic: 2.5, openai: 3, google: 3 };

export function estimateTokens(text: string, provider: ProviderId): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN[provider]);
}

/** Normalised from each provider's usage report by the adapters. */
export interface UsageReport {
  /** Total input tokens the provider billed for the turn (cached ones included). */
  inputTokens: number;
  /** Of those, the tokens served from the provider's cache. */
  cachedInputTokens: number;
  outputTokens: number;
}

/** A response "reused the flow" when cached input covers at least 80% of the flow. */
export function reusedFlow(usage: UsageReport, flowTokens: number): boolean {
  if (flowTokens <= 0) return false;
  return usage.cachedInputTokens >= 0.8 * flowTokens;
}

export const LONG_CHAT_THRESHOLD = 0.65;

export function longChatRatio(args: { lastInputTokens: number; nextTurnEstimate: number; outputBudget: number; maxInputTokens: number }): number {
  if (args.maxInputTokens <= 0) return 0;
  return (args.lastInputTokens + args.nextTurnEstimate + args.outputBudget) / args.maxInputTokens;
}

export function isChatGettingLong(args: Parameters<typeof longChatRatio>[0]): boolean {
  return longChatRatio(args) >= LONG_CHAT_THRESHOLD;
}

const formatCount = (n: number) => new Intl.NumberFormat('en-US').format(Math.round(n));

/** The chip's hover line: the provider's own numbers, thousands separators, no rounding, no tilde. */
/** The flow chip's hover, one line: what reuse did on the last question, or the first question's size. */
export function hoverSummary(usage: UsageReport, provider: ProviderId): string {
  return usage.cachedInputTokens > 0
    ? `Last question: ${formatCount(usage.cachedInputTokens)} of ${formatCount(usage.inputTokens)} tokens reused from ${providerName(provider)}’s memory`
    : `First question: ${formatCount(usage.inputTokens)} tokens sent, ${formatCount(usage.outputTokens)} in the answer`;
}

/** The flow chip's pinned card: the same numbers as labelled rows. */
export function hoverRows(usage: UsageReport, provider: ProviderId): [label: string, value: string][] {
  return [
    ['Sent', `${formatCount(usage.inputTokens)} tokens`],
    [`Reused from ${providerName(provider)}’s memory`, formatCount(usage.cachedInputTokens)],
    ['In the answer', formatCount(usage.outputTokens)],
  ];
}

// ---------------------------------------------------------------------------
// Measuring the flow: the provider's free count endpoint when there is one,
// cached per flow version; the estimate otherwise.

export interface MeasureArgs {
  provider: ProviderId;
  apiKey: string;
  model: string;
  system: string;
  /** The wrapped flow block plus the first question shape, as the adapter will send it. */
  userText: string;
  /** Cache key: the flow version id. */
  versionId: string;
  signal?: AbortSignal;
}

export interface FlowMeasure {
  tokens: number;
  /** true when the provider counted; false when estimated. */
  exact: boolean;
}

export const COUNT_TIMEOUT_MS = 15_000;

type FetchLike = typeof fetch;

async function countAnthropic(args: MeasureArgs, signal: AbortSignal, fetchImpl: FetchLike): Promise<number> {
  const response = await fetchImpl('https://api.anthropic.com/v1/messages/count_tokens', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': args.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: args.model, system: args.system, messages: [{ role: 'user', content: args.userText }] }),
    signal,
  });
  if (!response.ok) throw new Error(`count_tokens ${response.status}`);
  const body = (await response.json()) as { input_tokens?: number };
  if (typeof body.input_tokens !== 'number') throw new Error('count_tokens: no input_tokens');
  return body.input_tokens;
}

async function countGoogle(args: MeasureArgs, signal: AbortSignal, fetchImpl: FetchLike): Promise<number> {
  const model = encodeURIComponent(args.model);
  const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:countTokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': args.apiKey },
    body: JSON.stringify({
      generateContentRequest: {
        model: `models/${args.model}`,
        systemInstruction: { parts: [{ text: args.system }] },
        contents: [{ role: 'user', parts: [{ text: args.userText }] }],
      },
    }),
    signal,
  });
  if (!response.ok) throw new Error(`countTokens ${response.status}`);
  const body = (await response.json()) as { totalTokens?: number };
  if (typeof body.totalTokens !== 'number') throw new Error('countTokens: no totalTokens');
  return body.totalTokens;
}

/**
 * Measures once per provider, model, and flow version. OpenAI has no count
 * endpoint, so it is always estimated; a failed or slow count falls back to
 * the estimate rather than blocking the panel.
 */
export function createFlowMeasurer(fetchImpl: FetchLike = (...a) => fetch(...a)) {
  const cache = new Map<string, FlowMeasure>();
  return async function measure(args: MeasureArgs): Promise<FlowMeasure> {
    const key = `${args.provider}:${args.model}:${args.versionId}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const estimate: FlowMeasure = { tokens: estimateTokens(args.system + args.userText, args.provider), exact: false };
    if (args.provider === 'openai') return estimate;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), COUNT_TIMEOUT_MS);
    const forward = () => controller.abort();
    args.signal?.addEventListener('abort', forward, { once: true });
    try {
      const tokens =
        args.provider === 'anthropic'
          ? await countAnthropic(args, controller.signal, fetchImpl)
          : await countGoogle(args, controller.signal, fetchImpl);
      const result = { tokens, exact: true };
      cache.set(key, result);
      return result;
    } catch (err) {
      if (args.signal?.aborted) throw err;
      return estimate;
    } finally {
      clearTimeout(timer);
      args.signal?.removeEventListener('abort', forward);
    }
  };
}
