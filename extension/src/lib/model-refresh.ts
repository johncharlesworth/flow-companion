// A key's model list is saved when the key is checked. Once a day at most, the panel re-reads each checked
// key's list when it opens, so a model a provider adds later appears without pasting the key in again. The
// read is the provider's free list-models call, the same one the check makes, which sends the key and
// nothing else. A failed read changes nothing; the next opening tries again. The demo flow never calls it:
// the demo sends nothing.

import type { ProviderId } from './models';
import { PROVIDERS } from './models';
import type { Settings } from './settings';
import type { KeyValidation } from './validate-key';

export const MODEL_LIST_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

/** Checked keys whose list is a day old or more. */
export function providersDue(settings: Settings, now: number): ProviderId[] {
  return PROVIDERS.filter((provider) => {
    const state = settings.keys[provider];
    return state.status === 'validated' && (state.checkedAt === null || now - state.checkedAt >= MODEL_LIST_MAX_AGE_MS);
  });
}

export interface RefreshDeps {
  now: number;
  getKey: (provider: ProviderId) => Promise<string | null>;
  validate: (provider: ProviderId, key: string) => Promise<KeyValidation>;
  update: (apply: (current: Settings) => Settings) => Promise<unknown>;
}

/** Re-reads each due key's list; returns the providers whose list was replaced. */
export async function refreshModelLists(settings: Settings, { now, getKey, validate, update }: RefreshDeps): Promise<ProviderId[]> {
  const refreshed: ProviderId[] = [];
  for (const provider of providersDue(settings, now)) {
    const key = await getKey(provider);
    if (!key) continue;
    const result = await validate(provider, key);
    if (result.outcome !== 'accepted') continue;
    const last4 = settings.keys[provider].last4;
    await update((current) => {
      const state = current.keys[provider];
      // The key was replaced or removed while the list was read: that key's own check saved its own list.
      if (state.status !== 'validated' || state.last4 !== last4) return current;
      return { ...current, keys: { ...current.keys, [provider]: { ...state, models: result.models, checkedAt: now } } };
    });
    refreshed.push(provider);
  }
  return refreshed;
}
