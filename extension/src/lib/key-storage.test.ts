import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { getProviderKey, moveProviderKeys, removeAllProviderKeys, removeProviderKey, setProviderKey } from './key-storage';

describe('key storage', () => {
  it('stores per-provider keys under prefixed keys in the chosen area', async () => {
    await setProviderKey('anthropic', 'key-A', 'local');
    await setProviderKey('openai', 'key-O', 'session');
    expect(await getProviderKey('anthropic', 'local')).toBe('key-A');
    expect(await getProviderKey('anthropic', 'session')).toBeNull();
    expect(await getProviderKey('openai', 'session')).toBe('key-O');
    expect(await getProviderKey('google', 'local')).toBeNull();
    expect(await fakeBrowser.storage.local.get('apiKey:anthropic')).toEqual({ 'apiKey:anthropic': 'key-A' });
  });

  it('removes the key for one provider without touching others', async () => {
    await setProviderKey('anthropic', 'key-A', 'local');
    await setProviderKey('openai', 'key-O', 'local');
    await removeProviderKey('anthropic', 'local');
    expect(await getProviderKey('anthropic', 'local')).toBeNull();
    expect(await getProviderKey('openai', 'local')).toBe('key-O');
  });

  it('moves every key between areas, verifying before deleting', async () => {
    await setProviderKey('anthropic', 'key-A', 'local');
    await setProviderKey('google', 'key-G', 'local');
    await moveProviderKeys('local', 'session');
    expect(await getProviderKey('anthropic', 'session')).toBe('key-A');
    expect(await getProviderKey('google', 'session')).toBe('key-G');
    expect(await getProviderKey('anthropic', 'local')).toBeNull();
    expect(await getProviderKey('google', 'local')).toBeNull();
    await moveProviderKeys('session', 'session');
    expect(await getProviderKey('anthropic', 'session')).toBe('key-A');
  });

  it('removeAllProviderKeys clears both areas and nothing else', async () => {
    await setProviderKey('anthropic', 'key-A', 'local');
    await setProviderKey('openai', 'key-O', 'session');
    await fakeBrowser.storage.local.set({ settings: { keep: true } });
    await removeAllProviderKeys();
    expect(await getProviderKey('anthropic', 'local')).toBeNull();
    expect(await getProviderKey('openai', 'session')).toBeNull();
    expect(await fakeBrowser.storage.local.get('settings')).toEqual({ settings: { keep: true } });
  });
});
