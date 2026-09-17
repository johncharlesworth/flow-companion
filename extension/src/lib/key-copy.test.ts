import { describe, expect, it } from 'vitest';

import { keyFormatHint, keyStatusLine } from './key-copy';

describe('keyStatusLine', () => {
  it('matches the design’s status states and names the provider when it could not be reached', () => {
    expect(keyStatusLine('anthropic', 'idle')).toBe('');
    expect(keyStatusLine('anthropic', 'checking')).toBe('Checking…');
    expect(keyStatusLine('anthropic', 'accepted')).toBe('Key accepted');
    expect(keyStatusLine('anthropic', 'rejected')).toBe('Key rejected — check it was copied fully');
    expect(keyStatusLine('google', 'unreachable')).toBe('Couldn’t reach Google — key saved. Check again when you’re online');
    expect(keyStatusLine('openai', 'rateLimited')).toBe('Rate limited — wait a minute, then check again');
  });
});

describe('keyFormatHint', () => {
  it('offers a switch when the key belongs to another provider', () => {
    expect(keyFormatHint('openai', { ok: false, detected: 'anthropic' })).toEqual({ text: 'This looks like an Anthropic key, but OpenAI is selected.', switchTo: 'anthropic' });
  });

  it('names the expected prefix when the key matches nothing', () => {
    expect(keyFormatHint('anthropic', { ok: false })).toEqual({ text: 'This doesn’t look like an Anthropic key — it should start with sk-ant-.' });
    expect(keyFormatHint('google', { ok: false })?.text).toContain('AIza');
  });

  it('is silent when the format is right', () => {
    expect(keyFormatHint('anthropic', { ok: true })).toBeNull();
  });
});
