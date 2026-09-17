import type { BrowserContext, Page } from '@playwright/test';

// A paced Anthropic mock installed inside the panel page (,
// "a paced SSE stream"). Playwright's network routes can only
// fulfil a response in one piece, so the pacing has to live in the page: the
// init script replaces `fetch` for api.anthropic.com and streams the scripted
// answer chunk by chunk on a timer, honouring the adapter's AbortSignal. Every
// other host still goes to the network layer (where Salesforce is routed).

export interface MockAnswer {
  /** Text deltas, streamed one per `delayMs`. */
  chunks: string[];
  delayMs: number;
  stopReason?: 'end_turn' | 'max_tokens' | 'refusal';
  inputTokens?: number;
  cachedInputTokens?: number;
}

export interface ProviderMockConfig {
  /** One entry per /v1/messages call, in order; the last entry repeats. */
  answers: MockAnswer[];
  /** What list-models reports. */
  models?: { id: string; max_input_tokens?: number }[];
  /** What count_tokens reports for the flow. */
  flowTokens?: number;
}

export interface RecordedCall {
  url: string;
  apiKey: string | null;
  browserAccess: string | null;
  body: unknown;
}

declare global {
  interface Window {
    __providerMock?: { calls: RecordedCall[] };
  }
}

function mockScript(config: ProviderMockConfig) {
  const calls: RecordedCall[] = [];
  window.__providerMock = { calls };
  const realFetch = window.fetch.bind(window);
  const encoder = new TextEncoder();
  const sse = (event: Record<string, unknown>) => encoder.encode(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`);
  const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
  const models = config.models ?? [
    { id: 'claude-sonnet-5', max_input_tokens: 1_000_000 },
    { id: 'claude-opus-5', max_input_tokens: 1_000_000 },
    { id: 'claude-haiku-4-5-20251001', max_input_tokens: 200_000 },
  ];

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.startsWith('https://api.anthropic.com/')) return realFetch(input, init);
    const headers = new Headers(init?.headers);
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url, apiKey: headers.get('x-api-key'), browserAccess: headers.get('anthropic-dangerous-direct-browser-access'), body });

    if (url.includes('/v1/models')) return json({ data: models.map((m) => ({ type: 'model', ...m })), has_more: false });
    if (url.endsWith('/v1/messages/count_tokens')) return json({ input_tokens: config.flowTokens ?? 1_200 });
    if (!url.endsWith('/v1/messages')) return new Response('not mocked', { status: 404 });

    const index = calls.filter((c) => c.url.endsWith('/v1/messages')).length - 1;
    const answer = config.answers[Math.min(index, config.answers.length - 1)]!;
    const signal = init?.signal ?? null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let i = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const abort = () => {
          clearTimeout(timer);
          try {
            controller.error(signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
          } catch {
            /* already closed */
          }
        };
        if (signal?.aborted) return abort();
        signal?.addEventListener('abort', abort, { once: true });
        controller.enqueue(
          sse({
            type: 'message_start',
            message: { usage: { input_tokens: answer.inputTokens ?? 1_300, cache_read_input_tokens: answer.cachedInputTokens ?? 0, cache_creation_input_tokens: 0, output_tokens: 0 } },
          }),
        );
        const tick = () => {
          if (i < answer.chunks.length) {
            controller.enqueue(sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: answer.chunks[i] } }));
            i += 1;
            timer = setTimeout(tick, answer.delayMs);
            return;
          }
          controller.enqueue(sse({ type: 'message_delta', delta: { stop_reason: answer.stopReason ?? 'end_turn' }, usage: { output_tokens: answer.chunks.length * 3 } }));
          controller.enqueue(sse({ type: 'message_stop' }));
          signal?.removeEventListener('abort', abort);
          controller.close();
        };
        timer = setTimeout(tick, answer.delayMs);
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
}

export async function installProviderMock(context: BrowserContext, config: ProviderMockConfig): Promise<void> {
  await context.addInitScript(mockScript, config);
}

export async function providerCalls(page: Page): Promise<RecordedCall[]> {
  return page.evaluate(() => window.__providerMock?.calls ?? []);
}

export const messageCalls = (calls: RecordedCall[]) => calls.filter((c) => c.url.endsWith('/v1/messages'));
