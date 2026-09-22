import { describe, expect, it } from 'vitest';

import sample from '@@/test/fixtures/synthetic-flow.json';

import { DEMO_DESCRIPTION, DEMO_LABEL, demoSample } from './demo-sample';

describe('demoSample', () => {
  it('replaces the fixture label and adds the description, leaving everything else alone', () => {
    const out = demoSample(sample);
    expect(out.label).toBe(DEMO_LABEL);
    expect(out.description).toBe(DEMO_DESCRIPTION);
    expect(out.interviewLabel).toBe('Customer Tier Routing Flow {!$Flow.CurrentDateTime}');
    expect(out.decisions).toBe(sample.decisions);
    expect(sample.label).toBe('Synthetic Test Flow');
  });
});
