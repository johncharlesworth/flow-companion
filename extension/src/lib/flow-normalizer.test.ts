import { describe, expect, it } from 'vitest';

import syntheticFlow from '../../test/fixtures/synthetic-flow.json';
import { normalizeFlow } from './flow-normalizer';

describe('normalizeFlow', () => {
  it('strips locationX and locationY from elements', () => {
    const input = { decisions: [{ name: 'D1', locationX: 200, locationY: 400, label: 'D1' }] };
    expect(normalizeFlow(input)).toEqual({ decisions: [{ name: 'D1', label: 'D1' }] });
  });

  it('strips empty processMetadataValues arrays', () => {
    const input = { decisions: [{ name: 'D1', processMetadataValues: [] }] };
    expect(normalizeFlow(input)).toEqual({ decisions: [{ name: 'D1' }] });
  });

  it('preserves non-empty processMetadataValues arrays', () => {
    const input = { decisions: [{ name: 'D1', processMetadataValues: [{ name: 'k', value: 'v' }] }] };
    expect(normalizeFlow(input)).toEqual({
      decisions: [{ name: 'D1', processMetadataValues: [{ name: 'k', value: 'v' }] }],
    });
  });

  it('strips nameSegment and versionSegment', () => {
    const input = { fullName: 'MyFlow-1', nameSegment: 'MyFlow', versionSegment: '1' };
    expect(normalizeFlow(input)).toEqual({ fullName: 'MyFlow-1' });
  });

  it('strips elementSubtype when null', () => {
    const input = { actionCalls: [{ name: 'A1', elementSubtype: null }] };
    expect(normalizeFlow(input)).toEqual({ actionCalls: [{ name: 'A1' }] });
  });

  it('preserves elementSubtype when non-null', () => {
    const input = { actionCalls: [{ name: 'A1', elementSubtype: 'apex' }] };
    expect(normalizeFlow(input)).toEqual({ actionCalls: [{ name: 'A1', elementSubtype: 'apex' }] });
  });

  it('collapses value blocks to non-null fields only', () => {
    const input = {
      assignments: [
        {
          assignmentItems: [
            {
              assignToReference: 'X',
              value: { stringValue: 'hello', numberValue: null, booleanValue: null, elementReference: null },
            },
          ],
        },
      ],
    };
    expect(normalizeFlow(input)).toEqual({
      assignments: [{ assignmentItems: [{ assignToReference: 'X', value: { stringValue: 'hello' } }] }],
    });
  });

  it('returns primitives, null, and undefined unchanged', () => {
    expect(normalizeFlow('foo')).toBe('foo');
    expect(normalizeFlow(42)).toBe(42);
    expect(normalizeFlow(null)).toBe(null);
    expect(normalizeFlow(undefined)).toBe(undefined);
    expect(normalizeFlow(true)).toBe(true);
  });

  it('walks arrays recursively', () => {
    const input = [
      { name: 'A', locationX: 10, locationY: 20 },
      { name: 'B', locationX: 30, locationY: 40 },
    ];
    expect(normalizeFlow(input)).toEqual([{ name: 'A' }, { name: 'B' }]);
  });

  it("tolerates keys it has never seen (Winter '27 End elements, grouping, tags)", () => {
    const input = {
      end: [{ name: 'End_1', label: 'End', locationX: 1, locationY: 2, grouping: 'Cleanup' }],
      tags: ['billing', 'q4'],
      someFutureBlock: { nested: { keep: true, elementSubtype: 'x' } },
    };
    expect(normalizeFlow(input)).toEqual({
      end: [{ name: 'End_1', label: 'End', grouping: 'Cleanup' }],
      tags: ['billing', 'q4'],
      someFutureBlock: { nested: { keep: true, elementSubtype: 'x' } },
    });
  });

  it('round-trips the synthetic flow fixture losslessly except for the noise fields', () => {
    const normalized = normalizeFlow(syntheticFlow) as Record<string, unknown>;
    expect(normalized).toHaveProperty('label');
    expect(normalized).toHaveProperty('processType');
    const json = JSON.stringify(normalized);
    expect(json).not.toContain('"locationX"');
    expect(json).not.toContain('"locationY"');
    expect(json).toContain('"CheckCustomerType"');
  });
});
