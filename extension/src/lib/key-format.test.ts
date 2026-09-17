import { describe, expect, it } from 'vitest';

import { validateKeyFormat } from './key-format';

describe('validateKeyFormat', () => {
  it('accepts a well-formed Anthropic key when provider=anthropic', () => {
    expect(validateKeyFormat('anthropic', 'sk-ant-api03-test12345')).toEqual({ ok: true });
  });

  it('detects an Anthropic key when provider=openai (cross-provider hint)', () => {
    expect(validateKeyFormat('openai', 'sk-ant-api03-test12345')).toEqual({ ok: false, detected: 'anthropic' });
  });

  it('accepts a legacy OpenAI key (sk-) when provider=openai', () => {
    expect(validateKeyFormat('openai', 'sk-test12345abcdef')).toEqual({ ok: true });
  });

  it('accepts a project-scoped OpenAI key (sk-proj-) when provider=openai', () => {
    expect(validateKeyFormat('openai', 'sk-proj-test12345abcdef')).toEqual({ ok: true });
  });

  it('accepts a Google key (AIza prefix) when provider=google', () => {
    expect(validateKeyFormat('google', 'AIzaSyTest1234567890abcdef')).toEqual({ ok: true });
  });

  it('returns ok=false with no detection when prefix matches no provider', () => {
    expect(validateKeyFormat('anthropic', 'random-string-no-prefix')).toEqual({ ok: false });
  });

  it('returns ok=false for empty string', () => {
    expect(validateKeyFormat('anthropic', '')).toEqual({ ok: false });
  });
});
