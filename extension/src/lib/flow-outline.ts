// The element index (lib/flow-outline.ts): built from the
// flow JSON without any model call. Feeds the Outline disclosure, the Explain
// picker, and the <focus_element> block's "reached from / connects to".

const ELEMENT_TYPES = [
  'start',
  'decisions',
  'assignments',
  'recordLookups',
  'recordCreates',
  'recordUpdates',
  'recordDeletes',
  'loops',
  'screens',
  'actionCalls',
  'apexPluginCalls',
  'subflows',
  'waits',
  'collectionProcessors',
  'transforms',
  'customErrors',
  'orchestratedStages',
  'steps',
  'recordRollbacks',
] as const;

const RESOURCE_TYPES = ['variables', 'formulas', 'constants', 'textTemplates', 'choices', 'dynamicChoiceSets', 'stages'] as const;

export const TYPE_LABEL: Record<string, string> = {
  start: 'Start',
  decisions: 'Decisions',
  assignments: 'Assignments',
  recordLookups: 'Get Records',
  recordCreates: 'Create Records',
  recordUpdates: 'Update Records',
  recordDeletes: 'Delete Records',
  loops: 'Loops',
  screens: 'Screens',
  actionCalls: 'Actions',
  apexPluginCalls: 'Apex plug-ins',
  subflows: 'Subflows',
  waits: 'Waits',
  collectionProcessors: 'Collection processors',
  transforms: 'Transforms',
  customErrors: 'Custom errors',
  orchestratedStages: 'Orchestration stages',
  steps: 'Steps',
  recordRollbacks: 'Roll back records',
  variables: 'Variables',
  formulas: 'Formulas',
  constants: 'Constants',
  textTemplates: 'Text templates',
  choices: 'Choices',
  dynamicChoiceSets: 'Choice sets',
  stages: 'Stages',
  other: 'Other',
};

export const START_NAME = 'Start';
export const UNGROUPED_THRESHOLD = 500;

export interface OutlineItem {
  name: string;
  label: string;
  type: string;
  kind: 'element' | 'resource';
}

export interface OutlineGroup {
  type: string;
  label: string;
  kind: 'element' | 'resource';
  items: OutlineItem[];
}

export interface FlowOutline {
  groups: OutlineGroup[];
  elementCount: number;
  resourceCount: number;
  predecessors: Map<string, string[]>;
  successors: Map<string, string[]>;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const isNamedArray = (v: unknown): v is Rec[] => Array.isArray(v) && v.every((x) => isRec(x) && typeof x.name === 'string');

function targetsOf(element: Rec): string[] {
  const out: string[] = [];
  const push = (c: unknown) => {
    if (isRec(c) && typeof c.targetReference === 'string') out.push(c.targetReference);
  };
  for (const key of ['connector', 'faultConnector', 'defaultConnector', 'nextValueConnector', 'noMoreValuesConnector']) push(element[key]);
  for (const key of ['rules', 'scheduledPaths', 'waitEvents']) {
    const list = element[key];
    if (Array.isArray(list)) for (const entry of list) if (isRec(entry)) push(entry.connector);
  }
  return out;
}

export function buildOutline(flow: unknown): FlowOutline {
  const groups: OutlineGroup[] = [];
  const predecessors = new Map<string, string[]>();
  const successors = new Map<string, string[]>();
  let elementCount = 0;
  let resourceCount = 0;
  if (!isRec(flow)) return { groups, elementCount, resourceCount, predecessors, successors };

  const link = (from: string, element: Rec) => {
    const targets = targetsOf(element);
    successors.set(from, targets);
    for (const t of targets) predecessors.set(t, [...(predecessors.get(t) ?? []), from]);
  };

  if (isRec(flow.start)) {
    groups.push({ type: 'start', label: TYPE_LABEL.start!, kind: 'element', items: [{ name: START_NAME, label: 'Start', type: 'start', kind: 'element' }] });
    elementCount += 1;
    link(START_NAME, flow.start);
  }
  const known = new Set<string>([...ELEMENT_TYPES, ...RESOURCE_TYPES]);
  const other: OutlineItem[] = [];
  for (const type of ELEMENT_TYPES) {
    if (type === 'start') continue;
    const list = flow[type];
    if (!isNamedArray(list) || list.length === 0) continue;
    const items = list.map((e) => ({ name: String(e.name), label: typeof e.label === 'string' && e.label ? e.label : String(e.name), type, kind: 'element' as const }));
    groups.push({ type, label: TYPE_LABEL[type] ?? type, kind: 'element', items });
    elementCount += items.length;
    for (const e of list) link(String(e.name), e);
  }
  for (const type of RESOURCE_TYPES) {
    const list = flow[type];
    if (!isNamedArray(list) || list.length === 0) continue;
    const items = list.map((e) => ({ name: String(e.name), label: typeof e.label === 'string' && e.label ? e.label : String(e.name), type, kind: 'resource' as const }));
    groups.push({ type, label: TYPE_LABEL[type] ?? type, kind: 'resource', items });
    resourceCount += items.length;
  }
  // Anything else shaped like an element list (a Winter '27 End element, a future type).
  for (const [key, value] of Object.entries(flow)) {
    if (known.has(key) || !isNamedArray(value) || value.length === 0) continue;
    for (const e of value) {
      other.push({ name: String(e.name), label: typeof e.label === 'string' && e.label ? e.label : String(e.name), type: key, kind: 'element' });
      link(String(e.name), e);
    }
  }
  if (other.length) {
    groups.push({ type: 'other', label: TYPE_LABEL.other!, kind: 'element', items: other });
    elementCount += other.length;
  }
  return { groups, elementCount, resourceCount, predecessors, successors };
}

/** "84 elements" (the size word was cut from the UI: the consequences are said in words where they matter) */
export function summaryLine(outline: FlowOutline): string {
  return `${outline.elementCount} element${outline.elementCount === 1 ? '' : 's'}`;
}

/** Case-insensitive match on label or API name; groups keep their order. */
export function filterOutline(outline: FlowOutline, query: string): OutlineGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return outline.groups;
  return outline.groups.map((g) => ({ ...g, items: g.items.filter((i) => i.label.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)) })).filter((g) => g.items.length > 0);
}

export function findElement(flow: unknown, name: string): unknown {
  if (!isRec(flow)) return undefined;
  if (name === START_NAME && isRec(flow.start)) return flow.start;
  for (const [key, value] of Object.entries(flow)) {
    if (key === 'start' || !isNamedArray(value)) continue;
    const hit = value.find((e) => e.name === name);
    if (hit) return hit;
  }
  return undefined;
}

export function focusElementFor(flow: unknown, outline: FlowOutline, name: string) {
  const json = findElement(flow, name);
  if (json === undefined) return null;
  return { name, json, before: outline.predecessors.get(name) ?? [], after: outline.successors.get(name) ?? [] };
}
