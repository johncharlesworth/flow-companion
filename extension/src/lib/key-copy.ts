// The status line and hints under the key field.
// Re-targeted from the earlier build test-connection-copy.ts onto validate-key's
// result; the two prefix-hint strings are kept.

import { EXPECTED_PREFIX, type KeyFormatResult } from './key-format';
import { type ProviderId, providerName } from './models';
import type { KeyValidation } from './validate-key';

export type KeyLineState = 'idle' | 'checking' | KeyValidation['outcome'];

export function keyStatusLine(provider: ProviderId, state: KeyLineState): string {
  switch (state) {
    case 'idle':
      return '';
    case 'checking':
      return 'Checking…';
    case 'accepted':
      return 'Key accepted';
    case 'rejected':
      return 'Key rejected — check it was copied fully';
    case 'unreachable':
      return `Couldn’t reach ${providerName(provider)} — key saved. Check again when you’re online`;
    case 'rateLimited':
      return 'Rate limited — wait a minute, then check again';
  }
}

export interface FormatHint {
  text: string;
  /** Offer a one-click switch to this provider. */
  switchTo?: ProviderId;
}

/** The format-mismatch hint, or null when the key looks right for the provider. */
export function keyFormatHint(provider: ProviderId, validation: KeyFormatResult): FormatHint | null {
  if (validation.ok) return null;
  if (validation.detected) {
    return {
      text: `This looks like an ${providerName(validation.detected)} key, but ${providerName(provider)} is selected.`,
      switchTo: validation.detected,
    };
  }
  return { text: `This doesn’t look like an ${providerName(provider)} key — it should start with ${EXPECTED_PREFIX[provider]}.` };
}
