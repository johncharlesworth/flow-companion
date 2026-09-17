import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { setProviderKey } from './key-storage';
import { CUSTOM_INSTRUCTIONS_MAX, defaultSettings, keyStorageMode, normalizeSettings, readiness, readSettings, updateSettings } from './settings';

describe('settings record', () => {
  it('defaults: no provider, launch default models, remember on, balanced detail', async () => {
    const s = await readSettings();
    expect(s).toEqual(defaultSettings());
    expect(s.modelByProvider).toEqual({ anthropic: 'claude-sonnet-5', openai: 'gpt-5.6-terra', google: 'gemini-3.5-flash' });
    expect(s.rememberOnDevice).toBe(true);
    expect(s.detail).toBe('balanced');
  });

  it('round-trips through one storage key and merges atomically', async () => {
    await updateSettings((s) => ({ ...s, activeProvider: 'openai', customInstructions: 'Answer in Portuguese.' }));
    await updateSettings((s) => ({ ...s, detail: 'thorough' }));
    const s = await readSettings();
    expect(s.activeProvider).toBe('openai');
    expect(s.customInstructions).toBe('Answer in Portuguese.');
    expect(s.detail).toBe('thorough');
    expect(Object.keys(await fakeBrowser.storage.local.get(null))).toEqual(['settings']);
  });

  it('drops malformed stored values and caps custom instructions', () => {
    const s = normalizeSettings({ activeProvider: 'bing', detail: 'loud', theme: 'neon', customInstructions: 'x'.repeat(2000), keys: { anthropic: { status: 'validated', last4: 'ABCDEFGH' } } });
    expect(s.activeProvider).toBeNull();
    expect(s.detail).toBe('balanced');
    expect(s.theme).toBe('system');
    expect(s.customInstructions).toHaveLength(CUSTOM_INSTRUCTIONS_MAX);
    expect(s.keys.anthropic).toEqual({ status: 'validated', last4: 'EFGH', models: [], checkedAt: null });
  });

  it('never stores an API key in the record', async () => {
    await updateSettings((s) => ({ ...s, keys: { ...s.keys, anthropic: { status: 'validated', last4: 'wxyz', models: [], checkedAt: 1 } } }));
    const raw = JSON.stringify(await fakeBrowser.storage.local.get('settings'));
    expect(raw).not.toMatch(/apiKey|sk-/);
  });

  it('readiness needs a validated status AND a present key, and flags a deliberately forgotten key', async () => {
    const base = defaultSettings();
    expect(await readiness(base)).toEqual({ ready: false, forgotten: false, unchecked: false });

    const validated = { ...base, activeProvider: 'anthropic' as const, keys: { ...base.keys, anthropic: { status: 'validated' as const, last4: 'wxyz', models: [], checkedAt: 1 } } };
    expect(await readiness(validated)).toEqual({ ready: false, forgotten: false, unchecked: false });
    await setProviderKey('anthropic', 'test-key-wxyz', 'local');
    expect(await readiness(validated)).toEqual({ ready: true, forgotten: false, unchecked: false });

    const notRemembered = { ...validated, rememberOnDevice: false };
    expect(keyStorageMode(notRemembered)).toBe('session');
    expect(await readiness(notRemembered)).toEqual({ ready: false, forgotten: true, unchecked: false });

    expect(normalizeSettings({ resizeTipDone: true }).resizeTipDone).toBe(true);
    expect(normalizeSettings({ resizeTipDone: 'yes' }).resizeTipDone).toBe(false);

    // A key whose check never completed is saved but not ready; the panel says to check it again.
    const unchecked = { ...validated, keys: { ...validated.keys, anthropic: { ...validated.keys.anthropic, status: 'unchecked' as const } } };
    await setProviderKey('anthropic', 'k', 'local');
    expect(await readiness(unchecked)).toEqual({ ready: false, forgotten: false, unchecked: true });
  });
});
