import { describe, expect, it, vi } from 'vitest';

import { MODEL_LIST_MAX_AGE_MS, providersDue, refreshModelLists } from './model-refresh';
import { defaultSettings, type Settings } from './settings';

const DAY = MODEL_LIST_MAX_AGE_MS;
const NOW = 1_800_000_000_000;

function withKeys(keys: Partial<Settings['keys']>): Settings {
  const s = defaultSettings();
  return { ...s, keys: { ...s.keys, ...keys } };
}

const OLD_LIST = [{ id: 'claude-sonnet-5', maxInputTokens: 1_000_000 }, { id: 'claude-opus-5', maxInputTokens: 1_000_000 }];
const NEW_LIST = [...OLD_LIST, { id: 'claude-opus-5-5', maxInputTokens: 1_000_000 }];

describe('model list refresh', () => {
  it('is due for a checked key listed a day ago or more, never for an unchecked, rejected or unset one', () => {
    const settings = withKeys({
      anthropic: { status: 'validated', last4: 'wxyz', models: OLD_LIST, checkedAt: NOW - DAY },
      openai: { status: 'validated', last4: 'abcd', models: [], checkedAt: NOW - DAY + 1 },
      google: { status: 'rejected', last4: 'efgh', models: [], checkedAt: null },
    });
    expect(providersDue(settings, NOW)).toEqual(['anthropic']);
    expect(providersDue(withKeys({ google: { status: 'unchecked', last4: 'efgh', models: [], checkedAt: null } }), NOW)).toEqual([]);
  });

  it('replaces a key’s old saved list with the list the provider gives today: Opus 5.5 appears with no key pasted again', async () => {
    let stored = withKeys({ anthropic: { status: 'validated', last4: 'wxyz', models: OLD_LIST, checkedAt: 1 } });
    const validate = vi.fn(async () => ({ outcome: 'accepted' as const, models: NEW_LIST }));
    const refreshed = await refreshModelLists(stored, {
      now: NOW,
      getKey: async () => 'sk-ant-test-wxyz',
      validate,
      update: async (apply) => (stored = apply(stored)),
    });
    expect(refreshed).toEqual(['anthropic']);
    expect(validate).toHaveBeenCalledWith('anthropic', 'sk-ant-test-wxyz');
    expect(stored.keys.anthropic).toEqual({ status: 'validated', last4: 'wxyz', models: NEW_LIST, checkedAt: NOW });
  });

  it('a failed read changes nothing, so the next opening tries again; a missing key is not read at all', async () => {
    for (const outcome of ['rejected', 'rateLimited', 'unreachable'] as const) {
      let stored = withKeys({ anthropic: { status: 'validated', last4: 'wxyz', models: OLD_LIST, checkedAt: 1 } });
      const before = stored;
      await refreshModelLists(stored, { now: NOW, getKey: async () => 'k', validate: async () => ({ outcome }), update: async (apply) => (stored = apply(stored)) });
      expect(stored).toBe(before);
    }
    const validate = vi.fn();
    await refreshModelLists(withKeys({ anthropic: { status: 'validated', last4: 'wxyz', models: OLD_LIST, checkedAt: 1 } }), { now: NOW, getKey: async () => null, validate, update: vi.fn() });
    expect(validate).not.toHaveBeenCalled();
  });

  it('a key replaced while its list was being read keeps the list its own check saved', async () => {
    let stored = withKeys({ anthropic: { status: 'validated', last4: 'wxyz', models: OLD_LIST, checkedAt: 1 } });
    const snapshot = stored;
    stored = withKeys({ anthropic: { status: 'validated', last4: 'new1', models: OLD_LIST, checkedAt: NOW - 5 } });
    const replaced = stored;
    await refreshModelLists(snapshot, { now: NOW, getKey: async () => 'k', validate: async () => ({ outcome: 'accepted', models: NEW_LIST }), update: async (apply) => (stored = apply(stored)) });
    expect(stored).toBe(replaced);
  });
});
