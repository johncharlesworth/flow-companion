import { describe, expect, it, vi } from 'vitest';

import { validateKey } from './validate-key';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('validateKey', () => {
  it('Anthropic: pages the list, sends the browser header, keeps the key out of the URL, filters Fable', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('after_id=')
        ? json({ data: [{ id: 'claude-fable-5-1', max_input_tokens: 1_000_000 }], has_more: false })
        : json({ data: [{ id: 'claude-sonnet-5', max_input_tokens: 1_000_000 }], has_more: true, last_id: 'claude-sonnet-5' }),
    );
    const result = await validateKey('anthropic', 'test-key', fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ outcome: 'accepted', models: [{ id: 'claude-sonnet-5', maxInputTokens: 1_000_000 }] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/models?limit=1000');
    const headers = new Headers(init.headers);
    expect(headers.get('x-api-key')).toBe('test-key');
    expect(headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
  });

  it('OpenAI: Bearer header, chat models only', async () => {
    const fetchImpl = vi.fn(async () => json({ data: [{ id: 'gpt-5.6-terra' }, { id: 'gpt-image-2' }, { id: 'o3' }] }));
    expect(await validateKey('openai', 'test-key', fetchImpl as unknown as typeof fetch)).toEqual({ outcome: 'accepted', models: [{ id: 'gpt-5.6-terra' }] });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/models');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-key');
  });

  it('Google: key in a header, pages with nextPageToken, keeps generateContent models with their limits', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('pageToken=')
        ? json({ models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 1_048_576 }] })
        : json({ models: [{ name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 1_048_576 }], nextPageToken: 'p2' }),
    );
    const result = await validateKey('google', 'test-key', fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ outcome: 'accepted', models: [{ id: 'gemini-3.5-flash', maxInputTokens: 1_048_576 }, { id: 'gemini-3.8-flash', maxInputTokens: 1_048_576 }] });
    for (const [url, init] of fetchImpl.mock.calls as unknown as [string, RequestInit][]) {
      expect(url).not.toContain('key=');
      expect(new Headers(init.headers).get('x-goog-api-key')).toBe('test-key');
    }
  });

  it.each([
    [401, 'rejected'],
    [403, 'rejected'],
    [400, 'rejected'],
    [429, 'rateLimited'],
    [503, 'unreachable'],
  ])('HTTP %d -> %s', async (status, outcome) => {
    const fetchImpl = vi.fn(async () => json({ error: 'x' }, status));
    expect(await validateKey('openai', 'test-key', fetchImpl as unknown as typeof fetch)).toEqual({ outcome });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('a network failure is unreachable and is not retried', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await validateKey('anthropic', 'test-key', fetchImpl as unknown as typeof fetch)).toEqual({ outcome: 'unreachable' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
