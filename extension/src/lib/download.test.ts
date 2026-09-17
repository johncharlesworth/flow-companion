import { describe, expect, it } from 'vitest';

import { downloadFilename } from './download';

describe('downloadFilename', () => {
  it('uses the flow label and version, with filesystem-unsafe characters removed', () => {
    expect(downloadFilename('Lane Four - Opp After Save', 52, 'json')).toBe('Lane Four - Opp After Save v52.json');
    expect(downloadFilename('Quotes: "Big/Small" <draft>', 3, 'md')).toBe('Quotes Big Small draft v3.md');
    expect(downloadFilename('../../etc/passwd', 2, 'json')).toBe('.. .. etc passwd v2.json');
    expect(downloadFilename('   ', 1, 'json')).toBe('Flow v1.json');
  });
});
