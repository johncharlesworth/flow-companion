// Chat-time error copy (table). Every class has a title, one
// sentence, and one action. Raw provider text never reaches this file.

import { type ProviderId, providerName } from './models';
import type { ChatErrorClass } from './providers/types';

export type ChatErrorAction = 'openSettings' | 'openBilling' | 'retry' | 'openProviderSite' | 'openModelMenu' | 'switchModel' | 'none';

export interface ChatErrorCopy {
  title: string;
  body: string;
  actions: ChatErrorAction[];
}

export const BILLING_URL: Record<ProviderId, string> = {
  anthropic: 'https://console.anthropic.com/settings/billing',
  openai: 'https://platform.openai.com/settings/organization/billing/overview',
  google: 'https://aistudio.google.com/apikey',
};

export const RATE_LIMIT_URL: Record<ProviderId, string> = {
  anthropic: 'https://console.anthropic.com/settings/limits',
  openai: 'https://platform.openai.com/settings/organization/limits',
  google: 'https://aistudio.google.com/rate-limit',
};

export function chatErrorCopy(cls: ChatErrorClass, provider: ProviderId, extra: { tooBigFor?: string; fits?: string | null } = {}): ChatErrorCopy {
  const name = providerName(provider);
  switch (cls) {
    case 'keyRejected':
      return { title: 'Key no longer works', body: `Your ${name} key no longer works. Update it in Settings.`, actions: ['openSettings'] };
    case 'noCredit':
      return {
        title: 'No usage credit yet',
        body: `Your key works, but ${name} says the account has no usage credit yet. Add a payment method or credits on their site, then try again.`,
        actions: ['openBilling'],
      };
    case 'rateLimit':
      return {
        title: 'Rate limit reached',
        body: `Your ${name} account hit its rate limit. Wait a minute, then retry. If it keeps happening, ${name}’s site shows how to raise the limit.`,
        actions: ['retry', 'openProviderSite'],
      };
    case 'modelUnavailable':
      return { title: 'Model unavailable', body: 'This model is no longer available. Pick another.', actions: ['openModelMenu'] };
    case 'providerBusy':
      return { title: 'Busy right now', body: `${name} is busy right now. Wait a moment, then retry.`, actions: ['retry'] };
    case 'requestTooLarge':
      return {
        title: 'Too big for this model',
        body: extra.fits
          ? `This flow is too big for ${extra.tooBigFor ?? 'this model'}. ${extra.fits} can read it.`
          : `This flow is too big for ${extra.tooBigFor ?? 'this model'}. Try a larger model.`,
        actions: extra.fits ? ['switchModel'] : ['openModelMenu'],
      };
    case 'interrupted':
      return { title: 'Connection dropped', body: 'The connection dropped. Nothing was lost on your side; Retry sends the question again.', actions: ['retry'] };
    case 'unknown':
      return { title: 'Something went wrong', body: `${name} returned an unexpected response. Retry sends the question again.`, actions: ['retry'] };
  }
}

/** Footer lines for answers that did not finish normally. */
export const FOOTER = {
  stopped: 'Stopped',
  /** Stop pressed before the first word arrived: there is no partial to keep (a real-Chrome check). */
  stoppedEmpty: 'Stopped before anything arrived.',
  interrupted: 'Interrupted',
  cutOff: 'Answer was cut off',
  declined: 'The model declined to answer',
} as const;
