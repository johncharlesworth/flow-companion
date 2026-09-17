// Where each provider's keys and prices live, and the per-provider copy from
// . Provider-named sentences name the company that bills.

import type { ProviderId } from './models';

export const GET_KEY_URL: Record<ProviderId, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  google: 'https://aistudio.google.com/apikey',
};

export const PRICING_URL: Record<ProviderId, string> = {
  anthropic: 'https://www.anthropic.com/pricing',
  openai: 'https://openai.com/api/pricing/',
  google: 'https://ai.google.dev/pricing',
};

/** The homepage section that explains what is sent; the site must be live before the store submission. */
export const WHAT_IS_SENT_URL = 'https://getflowcompanion.com/#what-is-sent';

export const CARD_TITLE: Record<ProviderId, string> = {
  anthropic: 'Anthropic · Claude models',
  openai: 'OpenAI · GPT models',
  google: 'Google · Gemini models',
};

export function disclosureFor(providerLabel: string): string {
  return `When you chat, this flow’s saved metadata — element names, formulas, and text — is sent to ${providerLabel} under your key. No records, and nothing goes anywhere else.`;
}

export const SUBSCRIPTION_NOTE = 'Pick the provider you have an account with, then paste an API key from its developer console. A ChatGPT, Claude, or Gemini chat subscription won’t work here; you need an API key.';

export const GOOGLE_FREE_TIER_NOTE = 'On Google’s free tier, prompts may be used to improve Google’s models. Use a paid project if that matters for your org.';
