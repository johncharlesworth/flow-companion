// Key validation through each provider's free list-models call, which also
// yields what the key can use. The key goes in a
// header, never a URL. Nothing here retries.

import { filterAnthropicModels, filterGoogleModels, filterOpenAiModels, type LiveModel, type ProviderId } from './models';

export type KeyValidation =
  | { outcome: 'accepted'; models: LiveModel[] }
  | { outcome: 'rejected' }
  | { outcome: 'rateLimited' }
  | { outcome: 'unreachable' };

export const VALIDATE_TIMEOUT_MS = 15_000;

type FetchLike = typeof fetch;

async function anthropic(apiKey: string, fetchImpl: FetchLike, signal: AbortSignal): Promise<KeyValidation> {
  const all: Parameters<typeof filterAnthropicModels>[0] = [];
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const url = new URL('https://api.anthropic.com/v1/models');
    url.searchParams.set('limit', '1000');
    if (after) url.searchParams.set('after_id', after);
    const response = await fetchImpl(url.toString(), {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      signal,
    });
    const outcome = outcomeFor(response.status);
    if (outcome) return outcome;
    const body = (await response.json()) as { data?: typeof all; has_more?: boolean; last_id?: string };
    all.push(...(body.data ?? []));
    if (!body.has_more || !body.last_id) break;
    after = body.last_id;
  }
  return { outcome: 'accepted', models: filterAnthropicModels(all) };
}

async function openai(apiKey: string, fetchImpl: FetchLike, signal: AbortSignal): Promise<KeyValidation> {
  const response = await fetchImpl('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${apiKey}` }, signal });
  const outcome = outcomeFor(response.status);
  if (outcome) return outcome;
  const body = (await response.json()) as { data?: Parameters<typeof filterOpenAiModels>[0] };
  return { outcome: 'accepted', models: filterOpenAiModels(body.data ?? []) };
}

async function google(apiKey: string, fetchImpl: FetchLike, signal: AbortSignal): Promise<KeyValidation> {
  const all: Parameters<typeof filterGoogleModels>[0] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < 10; page++) {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetchImpl(url.toString(), { headers: { 'x-goog-api-key': apiKey }, signal });
    const outcome = outcomeFor(response.status);
    if (outcome) return outcome;
    const body = (await response.json()) as { models?: typeof all; nextPageToken?: string };
    all.push(...(body.models ?? []));
    if (!body.nextPageToken) break;
    pageToken = body.nextPageToken;
  }
  return { outcome: 'accepted', models: filterGoogleModels(all) };
}

function outcomeFor(status: number): KeyValidation | null {
  if (status === 200) return null;
  if (status === 401 || status === 403 || status === 400) return { outcome: 'rejected' };
  if (status === 429) return { outcome: 'rateLimited' };
  return { outcome: 'unreachable' };
}

export async function validateKey(provider: ProviderId, apiKey: string, fetchImpl: FetchLike = (...a) => fetch(...a)): Promise<KeyValidation> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VALIDATE_TIMEOUT_MS);
  try {
    const run = provider === 'anthropic' ? anthropic : provider === 'openai' ? openai : google;
    return await run(apiKey, fetchImpl, controller.signal);
  } catch {
    return { outcome: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
