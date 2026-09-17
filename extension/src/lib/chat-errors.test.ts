import { describe, expect, it } from 'vitest';

import { chatErrorCopy } from './chat-errors';
import type { ChatErrorClass } from './providers/types';

const ALL: ChatErrorClass[] = ['keyRejected', 'noCredit', 'rateLimit', 'modelUnavailable', 'providerBusy', 'requestTooLarge', 'interrupted', 'unknown'];

describe('chatErrorCopy', () => {
  it('uses the plan’s sentences and names the provider', () => {
    expect(chatErrorCopy('keyRejected', 'anthropic').body).toBe('Your Anthropic key no longer works. Update it in Settings.');
    expect(chatErrorCopy('noCredit', 'openai').body).toMatch(/OpenAI says the account has no usage credit yet/);
    expect(chatErrorCopy('rateLimit', 'google').body).toBe('Your Google account hit its rate limit. Wait a minute, then retry. If it keeps happening, Google’s site shows how to raise the limit.');
    expect(chatErrorCopy('providerBusy', 'anthropic').body).toBe('Anthropic is busy right now. Wait a moment, then retry.');
    expect(chatErrorCopy('interrupted', 'anthropic').body).toBe('The connection dropped. Nothing was lost on your side; Retry sends the question again.');
    expect(chatErrorCopy('requestTooLarge', 'anthropic', { tooBigFor: 'Claude Haiku', fits: 'Claude Sonnet 5' }).body).toBe('This flow is too big for Claude Haiku. Claude Sonnet 5 can read it.');
  });

  it('every class has a title, one sentence or two, and the title is never repeated in the body', () => {
    for (const cls of ALL) {
      const copy = chatErrorCopy(cls, 'anthropic');
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body).not.toContain(copy.title);
      expect(copy.body).not.toMatch(/\b(HTTP|4\d\d|5\d\d|JSON|stack)\b/);
    }
  });

  it('retry is offered only where retrying can help', () => {
    expect(chatErrorCopy('keyRejected', 'anthropic').actions).toEqual(['openSettings']);
    expect(chatErrorCopy('rateLimit', 'anthropic').actions).toContain('retry');
    expect(chatErrorCopy('modelUnavailable', 'anthropic').actions).toEqual(['openModelMenu']);
  });
});
