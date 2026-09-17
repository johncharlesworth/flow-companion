import { describe, expect, it } from 'vitest';

import { formatSavedAgo } from './relative-time';

const NOW = Date.parse('2026-09-03T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('formatSavedAgo', () => {
  it.each([
    [0, 'Saved just now'],
    [59_000, 'Saved just now'],
    [3 * 60_000, 'Saved 3 min ago'],
    [59 * 60_000, 'Saved 59 min ago'],
    [2 * 3_600_000, 'Saved 2 h ago'],
    [30 * 3_600_000, 'Saved yesterday'],
    [5 * 86_400_000, 'Saved 5 days ago'],
  ])('%d ms ago -> %s', (ms, expected) => {
    expect(formatSavedAgo(ago(ms), NOW)).toBe(expected);
  });

  it('falls back to a date after two weeks', () => {
    expect(formatSavedAgo(ago(20 * 86_400_000), NOW)).toMatch(/^Saved on /);
  });

  it('accepts the Salesforce timestamp format and never goes negative', () => {
    expect(formatSavedAgo('2026-09-03T11:57:00.000+0000', NOW)).toBe('Saved 3 min ago');
    expect(formatSavedAgo(ago(-60_000), NOW)).toBe('Saved just now');
    expect(formatSavedAgo('not a date', NOW)).toBe('');
  });
});
