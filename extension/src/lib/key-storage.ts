// Per-provider API keys, in chrome.storage.local when "Remember this key on
// this computer" is on, in chrome.storage.session when it is off (invariant 4:
// keys live only in chrome.storage). Ported from the earlier build
// byok-key-storage.ts; ProviderId now comes from models.ts.

import { browser } from 'wxt/browser';

import { type ProviderId, PROVIDERS } from './models';

export type KeyStorageMode = 'local' | 'session';

const PREFIX = 'apiKey:';

function area(mode: KeyStorageMode) {
  return mode === 'session' ? browser.storage.session : browser.storage.local;
}

export async function setProviderKey(provider: ProviderId, apiKey: string, mode: KeyStorageMode): Promise<void> {
  await area(mode).set({ [PREFIX + provider]: apiKey });
}

export async function getProviderKey(provider: ProviderId, mode: KeyStorageMode): Promise<string | null> {
  const stored = (await area(mode).get(PREFIX + provider)) as Record<string, unknown>;
  const value = stored[PREFIX + provider];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function removeProviderKey(provider: ProviderId, mode: KeyStorageMode): Promise<void> {
  await area(mode).remove(PREFIX + provider);
}

/**
 * Moves every provider's key between areas when "remember" changes: write to
 * the new area, verify it is there, then delete from the old one. Readiness
 * never changes as a result.
 */
export async function moveProviderKeys(from: KeyStorageMode, to: KeyStorageMode): Promise<void> {
  if (from === to) return;
  for (const provider of PROVIDERS) {
    const key = await getProviderKey(provider, from);
    if (!key) continue;
    await setProviderKey(provider, key, to);
    if ((await getProviderKey(provider, to)) === key) await removeProviderKey(provider, from);
  }
}

export async function removeAllProviderKeys(): Promise<void> {
  for (const mode of ['local', 'session'] as const) {
    await area(mode).remove(PROVIDERS.map((p) => PREFIX + p));
  }
}
