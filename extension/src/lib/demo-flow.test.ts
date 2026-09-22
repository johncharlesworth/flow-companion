import { describe, expect, it } from 'vitest';

import { DEMO_LABEL, DEMO_PATH, isDemoRequested, loadDemoFlow } from './demo-flow';

describe('demo-flow', () => {
  it('recognises the demo query and nothing else', () => {
    expect(isDemoRequested('?demo=1')).toBe(true);
    expect(isDemoRequested(DEMO_PATH.slice(DEMO_PATH.indexOf('?')))).toBe(true);
    expect(isDemoRequested('')).toBe(false);
    expect(isDemoRequested('?demo=0')).toBe(false);
    expect(isDemoRequested('?other=1')).toBe(false);
  });

  it('loads the demo flow as an active v4 saved just now, keyed to its own org so it never mixes with a real chat', async () => {
    const now = Date.parse('2026-09-03T12:00:00.000Z');
    const flow = await loadDemoFlow(now);
    expect(flow.loaded.record).toMatchObject({ MasterLabel: DEMO_LABEL, VersionNumber: 4, Status: 'Active', LastModifiedDate: '2026-09-03T12:00:00.000Z' });
    expect(flow.loaded.definition.ActiveVersionNumber).toBe(4);
    expect(flow.key).toBe('chat:demo:300XXXX0000ABCDxyz');
    expect(flow.orgId).toBe('demo');
    // The metadata is the normalised sample: a real flow shape with a Start, a decision, and DML.
    const metadata = flow.metadata as { start?: unknown; decisions?: unknown[]; recordCreates?: unknown[] };
    expect(metadata.start).toBeDefined();
    expect(metadata.decisions?.length).toBeGreaterThan(0);
    expect(metadata.recordCreates?.length).toBeGreaterThan(0);
  });
});
