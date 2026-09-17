// One settings record in chrome.storage.local. Keys are
// NOT in here: they live in key-storage.ts. Readiness means the active
// provider's status is validated and its key is present.

import { browser } from 'wxt/browser';

import { getProviderKey } from './key-storage';
import { type Detail, defaultModel, type LiveModel, type ProviderId, PROVIDERS } from './models';
import { isThemeSetting, type ThemeSetting } from './theme';

export type KeyStatus = 'unset' | 'validated' | 'rejected' | 'unchecked';

export interface ProviderKeyState {
  status: KeyStatus;
  /** The key's last four characters, for the status line; never the key. */
  last4: string | null;
  /** What the key could use when it was last validated. */
  models: LiveModel[];
  checkedAt: number | null;
}

export interface Settings {
  version: 1;
  activeProvider: ProviderId | null;
  modelByProvider: Record<ProviderId, string>;
  keys: Record<ProviderId, ProviderKeyState>;
  rememberOnDevice: boolean;
  theme: ThemeSetting;
  detail: Detail;
  customInstructions: string;
  /** The "drag the panel's edge" tip has done its job: the user has sent a first message. */
  resizeTipDone: boolean;
}

export const SETTINGS_KEY = 'settings';
export const CUSTOM_INSTRUCTIONS_MAX = 1_500;

const emptyKeyState = (): ProviderKeyState => ({ status: 'unset', last4: null, models: [], checkedAt: null });

export function defaultSettings(): Settings {
  return {
    version: 1,
    activeProvider: null,
    modelByProvider: { anthropic: defaultModel('anthropic').id, openai: defaultModel('openai').id, google: defaultModel('google').id },
    keys: { anthropic: emptyKeyState(), openai: emptyKeyState(), google: emptyKeyState() },
    rememberOnDevice: true,
    theme: 'system',
    detail: 'balanced',
    customInstructions: '',
    resizeTipDone: false,
  };
}

function isProvider(value: unknown): value is ProviderId {
  return PROVIDERS.includes(value as ProviderId);
}

/** Merges whatever is stored over the defaults, dropping anything malformed. */
export function normalizeSettings(raw: unknown): Settings {
  const base = defaultSettings();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<Record<keyof Settings, unknown>>;
  const out: Settings = { ...base };
  if (r.activeProvider === null || isProvider(r.activeProvider)) out.activeProvider = r.activeProvider;
  if (r.modelByProvider && typeof r.modelByProvider === 'object') {
    for (const p of PROVIDERS) {
      const id = (r.modelByProvider as Record<string, unknown>)[p];
      if (typeof id === 'string' && id) out.modelByProvider[p] = id;
    }
  }
  if (r.keys && typeof r.keys === 'object') {
    for (const p of PROVIDERS) {
      const k = (r.keys as Record<string, Partial<ProviderKeyState> | undefined>)[p];
      if (!k) continue;
      const status = k.status;
      out.keys[p] = {
        status: status === 'validated' || status === 'rejected' || status === 'unchecked' ? status : 'unset',
        last4: typeof k.last4 === 'string' ? k.last4.slice(-4) : null,
        models: Array.isArray(k.models) ? k.models.filter((m): m is LiveModel => !!m && typeof (m as LiveModel).id === 'string') : [],
        checkedAt: typeof k.checkedAt === 'number' ? k.checkedAt : null,
      };
    }
  }
  if (typeof r.rememberOnDevice === 'boolean') out.rememberOnDevice = r.rememberOnDevice;
  if (isThemeSetting(r.theme)) out.theme = r.theme;
  if (r.detail === 'concise' || r.detail === 'balanced' || r.detail === 'thorough') out.detail = r.detail;
  if (typeof r.customInstructions === 'string') out.customInstructions = r.customInstructions.slice(0, CUSTOM_INSTRUCTIONS_MAX);
  if (typeof r.resizeTipDone === 'boolean') out.resizeTipDone = r.resizeTipDone;
  return out;
}

export async function readSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY]);
}

export async function writeSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

/** Read, apply, write: the whole record moves at once. */
export async function updateSettings(apply: (current: Settings) => Settings): Promise<Settings> {
  const next = apply(await readSettings());
  await writeSettings(next);
  return next;
}

export function keyStorageMode(settings: Settings): 'local' | 'session' {
  return settings.rememberOnDevice ? 'local' : 'session';
}

export interface Readiness {
  ready: boolean;
  /** The key was deliberately not remembered and Chrome has restarted since. */
  forgotten: boolean;
  /** A key is saved but its check never completed (the provider was unreachable or rate limited). */
  unchecked: boolean;
}

/** Ready = the active provider's key is validated and actually present. */
export async function readiness(settings: Settings): Promise<Readiness> {
  const provider = settings.activeProvider;
  if (!provider) return { ready: false, forgotten: false, unchecked: false };
  const state = settings.keys[provider];
  const key = await getProviderKey(provider, keyStorageMode(settings));
  if (state.status === 'validated' && key) return { ready: true, forgotten: false, unchecked: false };
  return {
    ready: false,
    forgotten: state.status === 'validated' && !key && !settings.rememberOnDevice,
    unchecked: state.status === 'unchecked' && !!key,
  };
}

export function last4(key: string): string {
  return key.slice(-4);
}
