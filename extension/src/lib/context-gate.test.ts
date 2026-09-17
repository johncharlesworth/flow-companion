import { describe, expect, it } from 'vitest';

import { SAFETY_MARGIN_TOKENS, shouldBlockSend } from './context-gate';

const candidates = [
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', maxInputTokens: 200_000 },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', maxInputTokens: 1_000_000 },
  { id: 'claude-opus-5', label: 'Claude Opus 5', maxInputTokens: 1_000_000 },
];

describe('shouldBlockSend', () => {
  it('passes when total + 5,000 safety margin is within the input limit', () => {
    const r = shouldBlockSend({ maxInputTokens: 1_000_000, systemTokens: 2_000, flowTokens: 200_000, transcriptTokens: 50_000, assembledTurnTokens: 1_000, maxOutputTokens: 16_000 });
    expect(r).toEqual({ ok: true, totalTokens: 269_000 });
    expect(SAFETY_MARGIN_TOKENS).toBe(5_000);
  });

  it('blocks when total + margin exceeds the limit, by exactly the margin', () => {
    const r = shouldBlockSend({ maxInputTokens: 200_000, systemTokens: 2_000, flowTokens: 190_000, transcriptTokens: 0, assembledTurnTokens: 500, maxOutputTokens: 4_000 });
    expect(r.ok).toBe(false);
    const ok = shouldBlockSend({ maxInputTokens: 200_000, systemTokens: 2_000, flowTokens: 188_000, transcriptTokens: 0, assembledTurnTokens: 500, maxOutputTokens: 4_500 });
    expect(ok.ok).toBe(true);
  });

  it('suggests the smallest model on the same provider that fits, never the current one', () => {
    const r = shouldBlockSend({ maxInputTokens: 200_000, currentModelId: 'claude-haiku-4-5', systemTokens: 2_000, flowTokens: 400_000, transcriptTokens: 0, assembledTurnTokens: 500, maxOutputTokens: 16_000, candidates });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.suggested?.id).toBe('claude-sonnet-5');
    expect(r.ok === false && r.limit).toBe(200_000);
  });

  it('suggests nothing when no other model on the provider fits', () => {
    const r = shouldBlockSend({ maxInputTokens: 1_000_000, currentModelId: 'claude-sonnet-5', systemTokens: 2_000, flowTokens: 1_200_000, transcriptTokens: 0, assembledTurnTokens: 500, maxOutputTokens: 16_000, candidates });
    expect(r.ok === false && r.suggested).toBeNull();
  });

  it('counts the output reservation against the limit, so a Document turn can block where a chat turn passes', () => {
    const base = { maxInputTokens: 922_000, systemTokens: 2_000, flowTokens: 880_000, transcriptTokens: 10_000, assembledTurnTokens: 1_000 };
    expect(shouldBlockSend({ ...base, maxOutputTokens: 16_000 }).ok).toBe(true);
    expect(shouldBlockSend({ ...base, maxOutputTokens: 48_000 }).ok).toBe(false);
  });
});
