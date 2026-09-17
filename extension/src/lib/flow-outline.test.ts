import { describe, expect, it } from 'vitest';

import syntheticFlow from '../../test/fixtures/synthetic-flow.json';
import { buildOutline, filterOutline, findElement, focusElementFor, summaryLine } from './flow-outline';

describe('buildOutline', () => {
  const outline = buildOutline(syntheticFlow);

  it('groups elements by type with labels and API names, counts elements and resources separately', () => {
    expect(outline.groups.map((g) => [g.type, g.items.length])).toEqual([
      ['start', 1],
      ['decisions', 1],
      ['assignments', 1],
      ['recordCreates', 1],
      ['actionCalls', 1],
      ['variables', 1],
      ['formulas', 2],
    ]);
    expect(outline.elementCount).toBe(5);
    expect(outline.resourceCount).toBe(3);
    const decision = outline.groups.find((g) => g.type === 'decisions')!.items[0]!;
    expect(decision).toEqual({ name: 'CheckCustomerType', label: 'Check Customer Type', type: 'decisions', kind: 'element' });
    expect(summaryLine(outline)).toBe('5 elements');
  });

  it('builds the reverse index over every connector shape', () => {
    expect(outline.successors.get('Start')).toEqual(['CheckCustomerType']);
    expect(outline.successors.get('CheckCustomerType')).toEqual(['AssignFollowupOwner', 'UpdateAccount', 'AssignFollowupOwner']);
    expect(outline.predecessors.get('AssignFollowupOwner')).toEqual(['CheckCustomerType', 'CheckCustomerType', 'UpdateAccount']);
    expect(outline.predecessors.get('CreateFollowupTask')).toEqual(['AssignFollowupOwner']);
    expect(outline.successors.get('CreateFollowupTask')).toEqual([]);
  });

  it("puts unknown element arrays (a Winter '27 End element) under Other and still links them", () => {
    const flow = { ...syntheticFlow, end: [{ name: 'End_1', label: 'End', grouping: 'Cleanup' }], loops: [{ name: 'Loop_1', label: 'Each item', nextValueConnector: { targetReference: 'End_1' }, noMoreValuesConnector: { targetReference: 'CreateFollowupTask' } }], waits: [{ name: 'Wait_1', waitEvents: [{ name: 'e', connector: { targetReference: 'Loop_1' } }] }] };
    const o = buildOutline(flow);
    expect(o.groups.find((g) => g.type === 'other')?.items).toEqual([{ name: 'End_1', label: 'End', type: 'end', kind: 'element' }]);
    expect(o.successors.get('Loop_1')).toEqual(['End_1', 'CreateFollowupTask']);
    expect(o.predecessors.get('Loop_1')).toEqual(['Wait_1']);
    expect(o.elementCount).toBe(8);
  });

  it('searches label and API name, keeping group order, and tolerates junk input', () => {
    expect(filterOutline(outline, 'follow').map((g) => [g.type, g.items.map((i) => i.name)])).toEqual([
      ['assignments', ['AssignFollowupOwner']],
      ['recordCreates', ['CreateFollowupTask']],
    ]);
    expect(filterOutline(outline, 'CUSTOMER')[0]?.items[0]?.name).toBe('CheckCustomerType');
    expect(filterOutline(outline, '')).toBe(outline.groups);
    expect(buildOutline(null).elementCount).toBe(0);
    expect(buildOutline({ decisions: 'not an array', start: 'nope' }).groups).toEqual([]);
  });

  it('finds an element’s JSON and its neighbours for the focus block', () => {
    const focus = focusElementFor(syntheticFlow, outline, 'UpdateAccount')!;
    expect(focus.json).toMatchObject({ name: 'UpdateAccount', actionType: 'flow' });
    expect(focus.before).toEqual(['CheckCustomerType']);
    expect(focus.after).toEqual(['AssignFollowupOwner']);
    expect(focusElementFor(syntheticFlow, outline, 'Start')?.json).toMatchObject({ triggerType: 'RecordAfterSave' });
    expect(findElement(syntheticFlow, 'Nope')).toBeUndefined();
    expect(focusElementFor(syntheticFlow, outline, 'Nope')).toBeNull();
  });
});
