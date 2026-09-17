// Pure per-provider key prefix check, for the "this looks like an Anthropic
// key" hint. Ported verbatim from the earlier build format-validator.ts except
// the ProviderId import. Not a security control: the provider decides.

import type { ProviderId } from './models';

export type KeyFormatResult = { ok: true } | { ok: false; detected?: ProviderId };

const PREFIXES: Record<ProviderId, RegExp> = {
  anthropic: /^sk-ant-/,
  // OpenAI matches both `sk-proj-` and bare `sk-` but not `sk-ant-` (Anthropic).
  openai: /^sk-(?!ant-)/,
  google: /^AIza/,
};

export const EXPECTED_PREFIX: Record<ProviderId, string> = {
  anthropic: 'sk-ant-',
  openai: 'sk-',
  google: 'AIza',
};

export function validateKeyFormat(provider: ProviderId, key: string): KeyFormatResult {
  if (!key) return { ok: false };
  if (PREFIXES[provider].test(key)) return { ok: true };
  for (const [other, rgx] of Object.entries(PREFIXES) as [ProviderId, RegExp][]) {
    if (other !== provider && rgx.test(key)) return { ok: false, detected: other };
  }
  return { ok: false };
}
