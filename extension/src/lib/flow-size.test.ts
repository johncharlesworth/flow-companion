import { describe, expect, it, vi } from 'vitest';

import {
  COUNT_TIMEOUT_MS,
  createFlowMeasurer,
  estimateTokens,
  hoverRows,
  hoverSummary,
  isChatGettingLong,
  longChatRatio,
  reusedFlow,
  sizeWord,
} from './flow-size';

describe('sizeWord', () => {
  it.each([
    [0, 'small'],
    [49_999, 'small'],
    [50_000, 'medium'],
    [149_999, 'medium'],
    [150_000, 'large'],
    [399_999, 'large'],
    [400_000, 'very large'],
  ])('%d tokens -> %s', (tokens, word) => {
    expect(sizeWord(tokens)).toBe(word);
  });
});

describe('estimateTokens', () => {
  it('uses the provider divisor and rounds up', () => {
    const text = 'x'.repeat(1000);
    expect(estimateTokens(text, 'anthropic')).toBe(400);
    expect(estimateTokens(text, 'openai')).toBe(334);
    expect(estimateTokens(text, 'google')).toBe(334);
    expect(estimateTokens('', 'anthropic')).toBe(0);
  });
});

describe('reuse and length', () => {
  it('an answer reused the flow when cached input covers at least 80% of it', () => {
    expect(reusedFlow({ inputTokens: 245_800, cachedInputTokens: 231_200, outputTokens: 1_400 }, 230_000)).toBe(true);
    expect(reusedFlow({ inputTokens: 245_800, cachedInputTokens: 100_000, outputTokens: 1_400 }, 230_000)).toBe(false);
    expect(reusedFlow({ inputTokens: 10, cachedInputTokens: 10, outputTokens: 1 }, 0)).toBe(false);
  });

  it('the long-chat nudge fires at 65% of the model’s window', () => {
    const base = { nextTurnEstimate: 2_000, outputBudget: 16_000, maxInputTokens: 1_000_000 };
    expect(longChatRatio({ ...base, lastInputTokens: 600_000 })).toBeCloseTo(0.618);
    expect(isChatGettingLong({ ...base, lastInputTokens: 600_000 })).toBe(false);
    expect(isChatGettingLong({ ...base, lastInputTokens: 640_000 })).toBe(true);
    expect(longChatRatio({ ...base, maxInputTokens: 0, lastInputTokens: 1 })).toBe(0);
  });
});

describe('the flow chip’s numbers', () => {
  it('the hover is one line: reuse on a follow-up, size on the first question; thousands separators; the provider named', () => {
    expect(hoverSummary({ inputTokens: 245_800, cachedInputTokens: 231_200, outputTokens: 1_400 }, 'anthropic')).toBe('Last question: 231,200 of 245,800 tokens reused from Anthropic’s memory');
    expect(hoverSummary({ inputTokens: 207_687, cachedInputTokens: 0, outputTokens: 1_360 }, 'google')).toBe('First question: 207,687 tokens sent, 1,360 in the answer');
  });

  it('the pinned card has three labelled rows', () => {
    expect(hoverRows({ inputTokens: 245_800, cachedInputTokens: 231_200, outputTokens: 1_400 }, 'anthropic')).toEqual([
      ['Sent', '245,800 tokens'],
      ['Reused from Anthropic’s memory', '231,200'],
      ['In the answer', '1,400'],
    ]);
  });
});

describe('createFlowMeasurer', () => {
  const base = { apiKey: 'test-key', system: 'sys'.repeat(10), userText: 'flow'.repeat(100), versionId: '301XXXX0000ABCDxyz' };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('Anthropic: counts through the free endpoint with the browser header, never in the URL, and caches per version', async () => {
    const fetchImpl = vi.fn(async () => json({ input_tokens: 12_345 }));
    const measure = createFlowMeasurer(fetchImpl as unknown as typeof fetch);
    const first = await measure({ ...base, provider: 'anthropic', model: 'claude-sonnet-5' });
    expect(first).toEqual({ tokens: 12_345, exact: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages/count_tokens');
    expect(url).not.toContain('test-key');
    const headers = new Headers(init.headers);
    expect(headers.get('x-api-key')).toBe('test-key');
    expect(headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(JSON.parse(init.body as string)).toEqual({ model: 'claude-sonnet-5', system: base.system, messages: [{ role: 'user', content: base.userText }] });

    const second = await measure({ ...base, provider: 'anthropic', model: 'claude-sonnet-5' });
    expect(second).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('Google: counts with the key in a header and the generateContentRequest envelope', async () => {
    const fetchImpl = vi.fn(async () => json({ totalTokens: 9_876 }));
    const measure = createFlowMeasurer(fetchImpl as unknown as typeof fetch);
    expect(await measure({ ...base, provider: 'google', model: 'gemini-3.5-flash' })).toEqual({ tokens: 9_876, exact: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:countTokens');
    expect(url).not.toContain('key=');
    expect(new Headers(init.headers).get('x-goog-api-key')).toBe('test-key');
    const body = JSON.parse(init.body as string) as { generateContentRequest: { model: string; contents: unknown[] } };
    expect(body.generateContentRequest.model).toBe('models/gemini-3.5-flash');
    expect(body.generateContentRequest.contents).toHaveLength(1);
  });

  it('OpenAI has no count endpoint: estimated, no request', async () => {
    const fetchImpl = vi.fn();
    const measure = createFlowMeasurer(fetchImpl as unknown as typeof fetch);
    const result = await measure({ ...base, provider: 'openai', model: 'gpt-5.6-terra' });
    expect(result).toEqual({ tokens: estimateTokens(base.system + base.userText, 'openai'), exact: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back to the estimate when the count fails or times out, and does not cache the fallback', async () => {
    const fetchImpl = vi.fn(async () => json({ error: 'nope' }, 500));
    const measure = createFlowMeasurer(fetchImpl as unknown as typeof fetch);
    const result = await measure({ ...base, provider: 'anthropic', model: 'claude-sonnet-5' });
    expect(result.exact).toBe(false);
    await measure({ ...base, provider: 'anthropic', model: 'claude-sonnet-5' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    vi.useFakeTimers();
    try {
      const hanging = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))));
      const slow = createFlowMeasurer(hanging as unknown as typeof fetch);
      const pending = slow({ ...base, provider: 'google', model: 'gemini-3.5-flash' });
      await vi.advanceTimersByTimeAsync(COUNT_TIMEOUT_MS);
      expect((await pending).exact).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rethrows when the caller aborted (navigation), so a stale count never lands', async () => {
    const hanging = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))));
    const measure = createFlowMeasurer(hanging as unknown as typeof fetch);
    const controller = new AbortController();
    const pending = measure({ ...base, provider: 'anthropic', model: 'claude-sonnet-5', signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(DOMException);
  });
});
