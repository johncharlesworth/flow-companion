// Theme setting: System / Light / Dark. Lives in the settings record and is
// mirrored to localStorage so public/theme.js can apply it before first paint.

import { browser } from 'wxt/browser';

export type ThemeSetting = 'system' | 'light' | 'dark';

export const THEME_MIRROR_KEY = 'flow-companion:theme';

export function isThemeSetting(value: unknown): value is ThemeSetting {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function applyTheme(theme: ThemeSetting, root: HTMLElement = document.documentElement): void {
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}

function mirror(theme: ThemeSetting): void {
  try {
    // window.localStorage explicitly: Node also defines a bare localStorage global.
    if (theme === 'system') window.localStorage.removeItem(THEME_MIRROR_KEY);
    else window.localStorage.setItem(THEME_MIRROR_KEY, theme);
  } catch {
    /* storage unavailable */
  }
}

export async function readTheme(): Promise<ThemeSetting> {
  const stored = await browser.storage.local.get('settings');
  const value = (stored['settings'] as { theme?: unknown } | undefined)?.theme;
  return isThemeSetting(value) ? value : 'system';
}

export async function writeTheme(theme: ThemeSetting): Promise<void> {
  const stored = await browser.storage.local.get('settings');
  const current = (stored['settings'] as Record<string, unknown> | undefined) ?? {};
  await browser.storage.local.set({ settings: { ...current, theme } });
  mirror(theme);
  applyTheme(theme);
}

/** Applies and mirrors without writing (used after the settings record changed elsewhere). */
export function syncTheme(theme: ThemeSetting): void {
  mirror(theme);
  applyTheme(theme);
}
