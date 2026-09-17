import { describe, expect, it, vi } from 'vitest';

import { loadSystemPrompt } from '@/lib/system-prompt';

import { AnthropicProvider, buildAnthropicRequest, classifyAnthropicError } from './anthropic';
import { buildGoogleRequest, classifyGoogleError, GoogleProvider } from './google';
import { providerFor } from './index';
import { buildOpenAiRequest, classifyOpenAiError, OpenAiProvider } from './openai';
import type { Chunk, SendArgs } from './types';

const WRAPPED = '<flow_metadata_json>\n{"label":"Synthetic"}\n</flow_metadata_json>';

const base = (over: Partial<SendArgs> = {}): SendArgs => ({
  apiKey: 'test-key',
  model: { id: 'claude-sonnet-5', family: 'anthropic-5' },
  system: 'SYSTEM',
  wrappedFlow: WRAPPED,
  messages: [{ role: 'user', content: 'What does this flow do?' }],
  maxOutputTokens: 16_000,
  effort: 'medium',
  signal: new AbortController().signal,
  ...over,
});

const later = (over: Partial<SendArgs> = {}) =>
  base({
    messages: [
      { role: 'user', content: 'What does this flow do?' },
      { role: 'assistant', content: 'It routes accounts.' },
      { role: 'user', content: '<response_contract mode="overview">…</response_contract>\n<user_question>Overview please</user_question>' },
    ],
    ...over,
  });

function sse(events: string[], done = false): Response {
  const body = events.map((e) => `data: ${e}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : '');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function collect(iterable: AsyncIterable<Chunk>): Promise<Chunk[]> {
  const out: Chunk[] = [];
  for await (const c of iterable) out.push(c);
  return out;
}

// ---------------------------------------------------------------------------

describe('request builders: the cache prefix and the per-family rules', () => {
  it('Anthropic: two text blocks in the first user message, top-level 1h cache_control, effort only on the 5-series, no sampling params', () => {
    const body = buildAnthropicRequest(base());
    expect(body).toMatchSnapshot();
    expect(body.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: WRAPPED }, { type: 'text', text: 'What does this flow do?' }] });
    expect(body.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(body.output_config).toEqual({ effort: 'medium' });
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('top_p');
    expect(body).not.toHaveProperty('thinking');
    expect(JSON.stringify(body)).not.toContain('budget_tokens');

    expect(buildAnthropicRequest(base({ model: { id: 'claude-haiku-4-5-20251001', family: 'anthropic-haiku' }, effort: null }))).not.toHaveProperty('output_config');
    expect(buildAnthropicRequest(base({ model: { id: 'claude-sonnet-4-6', family: 'anthropic-4.6' }, effort: 'high' }))).not.toHaveProperty('output_config');
  });

  it('Anthropic: the first message is byte-identical across turns; later turns are plain strings', () => {
    const first = buildAnthropicRequest(base()).messages[0];
    const body = buildAnthropicRequest(later());
    expect(body.messages[0]).toEqual(first);
    expect(body.messages.slice(1)).toEqual([
      { role: 'assistant', content: 'It routes accounts.' },
      { role: 'user', content: '<response_contract mode="overview">…</response_contract>\n<user_question>Overview please</user_question>' },
    ]);
  });

  it('OpenAI: system message first, flow + first question in one user message, max_completion_tokens, usage requested, reasoning_effort on 5.x', () => {
    const body = buildOpenAiRequest(base({ model: { id: 'gpt-5.6-terra', family: 'openai-5.6' }, effort: 'low' }));
    expect(body).toMatchSnapshot();
    expect(body.messages[0]).toEqual({ role: 'system', content: 'SYSTEM' });
    expect(body.messages[1]).toEqual({ role: 'user', content: `${WRAPPED}\n\nWhat does this flow do?` });
    expect(body.max_completion_tokens).toBe(16_000);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.reasoning_effort).toBe('low');
    expect(buildOpenAiRequest(base({ model: { id: 'gpt-x', family: 'unknown' }, effort: 'low' }))).not.toHaveProperty('reasoning_effort');
  });

  it('Google: systemInstruction, user/model roles, maxOutputTokens, thinkingLevel on 3.x only', () => {
    const body = buildGoogleRequest(later({ model: { id: 'gemini-3.5-flash', family: 'google-3' }, effort: 'minimal' }));
    expect(body).toMatchSnapshot();
    expect(body.contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(body.contents[0]?.parts[0]?.text).toBe(`${WRAPPED}\n\nWhat does this flow do?`);
    expect(body.generationConfig).toEqual({ maxOutputTokens: 16_000, thinkingConfig: { thinkingLevel: 'minimal' } });
    expect(buildGoogleRequest(base({ model: { id: 'gemini-x', family: 'unknown' }, effort: 'low' })).generationConfig).toEqual({ maxOutputTokens: 16_000 });
  });

  it('the wrapped first message with the real system prompt is the cache prefix (snapshot)', () => {
    const body = buildAnthropicRequest(base({ system: loadSystemPrompt() }));
    expect({ system: body.system, first: body.messages[0] }).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------

describe('error classification never carries provider text', () => {
  it('Anthropic', () => {
    expect(classifyAnthropicError({ status: 401, code: 'authentication_error', message: 'invalid x-api-key' })).toEqual({ class: 'keyRejected', status: 401 });
    expect(classifyAnthropicError({ status: 400, code: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' })).toEqual({ class: 'noCredit', status: 400 });
    expect(classifyAnthropicError({ status: 400, code: 'invalid_request_error', message: 'prompt is too long: 1200000 tokens > 1000000 maximum' })).toEqual({ class: 'requestTooLarge', status: 400 });
    expect(classifyAnthropicError({ status: 404, code: 'not_found_error', message: 'model: claude-old' })).toEqual({ class: 'modelUnavailable', status: 404 });
    expect(classifyAnthropicError({ status: 429, code: 'rate_limit_error', message: 'x' })).toEqual({ class: 'rateLimit', status: 429 });
    expect(classifyAnthropicError({ status: 529, code: 'overloaded_error', message: 'x' })).toEqual({ class: 'providerBusy', status: 529 });
    expect(classifyAnthropicError({ status: 418, code: '', message: 'teapot' })).toEqual({ class: 'unknown', status: 418 });
  });

  it('OpenAI', () => {
    expect(classifyOpenAiError({ status: 429, code: 'insufficient_quota', message: 'You exceeded your current quota' })).toEqual({ class: 'noCredit', status: 429 });
    expect(classifyOpenAiError({ status: 429, code: 'rate_limit_exceeded', message: 'x' })).toEqual({ class: 'rateLimit', status: 429 });
    expect(classifyOpenAiError({ status: 400, code: 'context_length_exceeded', message: 'x' })).toEqual({ class: 'requestTooLarge', status: 400 });
    expect(classifyOpenAiError({ status: 401, code: 'invalid_api_key', message: 'x' })).toEqual({ class: 'keyRejected', status: 401 });
    expect(classifyOpenAiError({ status: 503, code: '', message: 'x' })).toEqual({ class: 'providerBusy', status: 503 });
  });

  it('Google', () => {
    expect(classifyGoogleError({ status: 400, code: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' })).toEqual({ class: 'keyRejected', status: 400 });
    expect(classifyGoogleError({ status: 429, code: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for the free tier' })).toEqual({ class: 'noCredit', status: 429 });
    expect(classifyGoogleError({ status: 429, code: 'RESOURCE_EXHAUSTED', message: 'Rate limit' })).toEqual({ class: 'rateLimit', status: 429 });
    expect(classifyGoogleError({ status: 400, code: 'INVALID_ARGUMENT', message: 'The input token count exceeds the maximum' })).toEqual({ class: 'requestTooLarge', status: 400 });
    expect(classifyGoogleError({ status: 404, code: 'NOT_FOUND', message: 'x' })).toEqual({ class: 'modelUnavailable', status: 404 });
  });
});

// ---------------------------------------------------------------------------

describe('streaming', () => {
  it('Anthropic: text, usage with cache figures, and the stop reason', async () => {
    const fetchImpl = vi.fn(async () =>
      sse([
        '{"type":"message_start","message":{"usage":{"input_tokens":1000,"cache_creation_input_tokens":0,"cache_read_input_tokens":230000,"output_tokens":1}}}',
        '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
        '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
        '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}',
        '{"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":1400}}',
        '{"type":"message_stop"}',
      ]),
    );
    const chunks = await collect(new AnthropicProvider(fetchImpl as unknown as typeof fetch).send(base()));
    expect(chunks).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'usage', usage: { inputTokens: 231_000, cachedInputTokens: 230_000, cacheWriteTokens: 0, outputTokens: 1400, reasoningTokens: 0 } },
      { type: 'stop', reason: 'max_tokens' },
    ]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = new Headers(init.headers);
    expect(headers.get('x-api-key')).toBe('test-key');
    expect(headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(headers.get('anthropic-version')).toBe('2023-06-01');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('OpenAI: text, usage incl. cached and reasoning tokens, finish_reason length -> max_tokens', async () => {
    const fetchImpl = vi.fn(async () =>
      sse(
        [
          '{"choices":[{"delta":{"role":"assistant","content":""}}]}',
          '{"choices":[{"delta":{"content":"Hi"}}]}',
          '{"choices":[{"delta":{},"finish_reason":"length"}]}',
          '{"choices":[],"usage":{"prompt_tokens":245800,"completion_tokens":1400,"prompt_tokens_details":{"cached_tokens":231200},"completion_tokens_details":{"reasoning_tokens":300}}}',
        ],
        true,
      ),
    );
    const chunks = await collect(new OpenAiProvider(fetchImpl as unknown as typeof fetch).send(base({ model: { id: 'gpt-5.6-terra', family: 'openai-5.6' } })));
    expect(chunks).toEqual([
      { type: 'text', text: 'Hi' },
      { type: 'usage', usage: { inputTokens: 245_800, cachedInputTokens: 231_200, cacheWriteTokens: 0, outputTokens: 1400, reasoningTokens: 300 } },
      { type: 'stop', reason: 'max_tokens' },
    ]);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-key');
  });

  it('Google: text (thoughts skipped), usage incl. cached and thoughts, SAFETY -> refusal; key only in the header', async () => {
    const fetchImpl = vi.fn(async () =>
      sse([
        '{"candidates":[{"content":{"parts":[{"text":"thinking…","thought":true},{"text":"Hello"}]}}]}',
        '{"candidates":[{"content":{"parts":[{"text":"!"}]},"finishReason":"SAFETY"}],"usageMetadata":{"promptTokenCount":100000,"candidatesTokenCount":50,"cachedContentTokenCount":90000,"thoughtsTokenCount":20}}',
      ]),
    );
    const chunks = await collect(new GoogleProvider(fetchImpl as unknown as typeof fetch).send(base({ model: { id: 'gemini-3.5-flash', family: 'google-3' }, effort: 'low' })));
    expect(chunks).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: '!' },
      { type: 'usage', usage: { inputTokens: 100_000, cachedInputTokens: 90_000, cacheWriteTokens: 0, outputTokens: 50, reasoningTokens: 20 } },
      { type: 'stop', reason: 'refusal' },
    ]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse');
    expect(url).not.toContain('key=');
    expect(new Headers(init.headers).get('x-goog-api-key')).toBe('test-key');
  });

  it('an HTTP failure becomes one error chunk with a class and status, and the provider text is not in it', async () => {
    const fetchImpl = vi.fn(async () => json(429, { error: { type: 'rate_limit_error', message: 'SECRET-DETAIL rate limited' } }));
    const chunks = await collect(new AnthropicProvider(fetchImpl as unknown as typeof fetch).send(base()));
    expect(chunks).toEqual([{ type: 'error', error: { class: 'rateLimit', status: 429 } }]);
    expect(JSON.stringify(chunks)).not.toContain('SECRET-DETAIL');
  });

  it('a network failure is "interrupted", and it is never retried (invariant 1)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const chunks = await collect(providerFor('openai', fetchImpl as unknown as typeof fetch).send(base({ model: { id: 'gpt-5.6-terra', family: 'openai-5.6' } })));
    expect(chunks).toEqual([{ type: 'error', error: { class: 'interrupted' } }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('a stream that ends without a stop event reports what it has, then "interrupted"', async () => {
    const fetchImpl = vi.fn(async () => sse(['{"type":"message_start","message":{"usage":{"input_tokens":10}}}', '{"type":"content_block_delta","delta":{"type":"text_delta","text":"partial"}}']));
    const chunks = await collect(new AnthropicProvider(fetchImpl as unknown as typeof fetch).send(base()));
    expect(chunks.map((c) => c.type)).toEqual(['text', 'usage', 'error']);
    expect(chunks[2]).toEqual({ type: 'error', error: { class: 'interrupted' } });
  });

  it('Stop: after the caller aborts, the adapter yields nothing more and does not report an error', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const iterator = new AnthropicProvider(fetchImpl as unknown as typeof fetch).send(base({ signal: controller.signal }));
    const pending = collect(iterator);
    controller.abort();
    expect(await pending).toEqual([]);
  });
});
