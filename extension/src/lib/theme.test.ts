import { beforeEach, describe, expect, it } from 'vitest';

import { applyTheme, isThemeSetting, readTheme, THEME_MIRROR_KEY, writeTheme } from './theme';

// happy-dom does not provide a working Storage on window in this setup, so the
// test installs an in-memory one that follows the same interface.
beforeEach(() => {
  const store = new Map<string, string>();
  const memory = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(window, 'localStorage', { value: memory, configurable: true });
});

describe('theme', () => {
  it('defaults to system when nothing is stored', async () => {
    expect(await readTheme()).toBe('system');
  });

  it('round-trips through storage, mirrors to localStorage, and applies to the root', async () => {
    await writeTheme('dark');
    expect(await readTheme()).toBe('dark');
    expect(window.localStorage.getItem(THEME_MIRROR_KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    await writeTheme('system');
    expect(await readTheme()).toBe('system');
    expect(window.localStorage.getItem(THEME_MIRROR_KEY)).toBeNull();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('applyTheme sets or clears data-theme', () => {
    const root = document.createElement('div');
    applyTheme('light', root);
    expect(root.dataset.theme).toBe('light');
    applyTheme('system', root);
    expect(root.dataset.theme).toBeUndefined();
  });

  it('isThemeSetting rejects anything else', () => {
    expect(isThemeSetting('dark')).toBe(true);
    expect(isThemeSetting('blue')).toBe(false);
    expect(isThemeSetting(undefined)).toBe(false);
  });
});
