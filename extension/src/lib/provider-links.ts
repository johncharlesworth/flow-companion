// Where each provider's keys and prices live, and the per-provider copy.
// Provider-named sentences name the company that bills.

import type { ProviderId } from './models';

export const GET_KEY_URL: Record<ProviderId, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  google: 'https://aistudio.google.com/apikey',
};

// Each provider's API prices per token, not its chat subscriptions: an admin here
// pays per token on their own key. anthropic.com/pricing and
// openai.com/api/pricing both open on subscription plans first.
export const PRICING_URL: Record<ProviderId, string> = {
  anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
  openai: 'https://developers.openai.com/api/docs/pricing',
  google: 'https://ai.google.dev/pricing',
};

/**
 * The docs page that explains what is sent: it opens on "What leaves your browser" and then
 * answers the session, key, and permission questions in order.
 */
export const WHAT_IS_SENT_URL = 'https://getflowcompanion.com/docs/privacy-and-security.html';

/** The docs index and the public repository's issues, linked from the bottom of Settings. */
export const DOCS_URL = 'https://getflowcompanion.com/docs/';
export const ISSUES_URL = 'https://github.com/johncharlesworth/flow-companion/issues';

export const CARD_TITLE: Record<ProviderId, string> = {
  anthropic: 'Anthropic · Claude models',
  openai: 'OpenAI · GPT models',
  google: 'Google · Gemini models',
};

export function disclosureFor(providerLabel: string): string {
  return `When you chat, this flow’s saved metadata is sent to ${providerLabel} under your key.`;
}

export const SUBSCRIPTION_NOTE = 'Pick a provider you have an account with and paste an API key from its developer console.';

export const GOOGLE_FREE_TIER_NOTE = 'On Google’s free tier, prompts may be used to improve Google’s models. Use a paid project if that matters for your org.';
