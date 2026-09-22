// The demo flow's answers: which recordings exist, what each one sends,
// and whether a set of answers is complete. Pure, so the recorder (which talks
// to a real provider), the package check, and the unit suite share one
// definition. The list of Explain answers is always derived from the flow's own
// outline, the same rows the Explain picker shows.
//
// Imports carry their .ts extension because the package check runs this file
// under plain Node, outside the bundler.

import { demoSample } from './demo-sample.ts';
import { normalizeFlow } from './flow-normalizer.ts';
import { buildOutline, focusElementFor } from './flow-outline.ts';
import { cleanMermaid, countNodes, extractMermaid } from './mermaid-text.ts';
import { assembleUserTurn } from './modes.ts';

type DemoAction = 'overview' | 'document' | 'draw' | 'explain';

export interface DemoRecording {
  /** `overview`, `document`, `draw`, or `explain:<picker name>`. */
  id: string;
  mode: DemoAction;
  /** Explain only: the element's name as the picker hands it over. */
  element?: string;
}

export interface DemoAnswersFile {
  /** True while the answers are hand-written placeholders rather than a model's. */
  provisional: boolean;
  answers: { overview: string; document: string; draw: string; explain: Record<string, string> };
}

export interface RecordingResult {
  text: string;
  /** The adapter's stop reason, or `error:<class>` when the request failed. */
  stop: string;
}

const WHOLE_FLOW_ACTIONS = ['overview', 'document', 'draw'] as const;
const DRAW_MIN_NODES = 3;
const DRAW_MAX_NODES = 15;

function pickerNames(sample: unknown): string[] {
  return buildOutline(normalizeFlow(demoSample(sample as object))).groups.flatMap((group) => group.items.map((item) => item.name));
}

/** Every recording the demo needs: the three whole-flow actions, then Explain for each picker row. */
export function demoRecordings(sample: unknown): DemoRecording[] {
  return [
    ...WHOLE_FLOW_ACTIONS.map((mode): DemoRecording => ({ id: mode, mode })),
    ...pickerNames(sample).map((element): DemoRecording => ({ id: `explain:${element}`, mode: 'explain', element })),
  ];
}

/** The user turn the panel sends for this action with nothing typed and no custom instructions. */
export function demoSentText(recording: DemoRecording, sample: unknown): string {
  if (recording.mode !== 'explain') {
    return assembleUserTurn({ mode: recording.mode, variant: recording.mode === 'draw' ? 'business' : undefined, question: '' }).sentText;
  }
  const metadata = normalizeFlow(demoSample(sample as object));
  const focusElement = focusElementFor(metadata, buildOutline(metadata), recording.element ?? '');
  if (!focusElement) throw new Error(`The demo flow has no element named ${JSON.stringify(recording.element)}.`);
  return assembleUserTurn({ mode: 'explain', question: '', focusElement }).sentText;
}

function diagramProblem(text: string): string | null {
  const block = extractMermaid(text);
  if (block === null) return 'no mermaid block';
  const nodes = countNodes(cleanMermaid(block));
  return nodes < DRAW_MIN_NODES || nodes > DRAW_MAX_NODES ? `${nodes} nodes, outside ${DRAW_MIN_NODES} to ${DRAW_MAX_NODES}` : null;
}

/** Why this result cannot be bundled, or null when it can. */
export function recordingProblem(recording: DemoRecording, result: RecordingResult | undefined): string | null {
  if (!result) return `${recording.id}: not recorded`;
  if (result.stop !== 'end') return `${recording.id}: stopped with ${result.stop}, not end`;
  if (!result.text.trim()) return `${recording.id}: empty answer`;
  const diagram = recording.mode === 'draw' ? diagramProblem(result.text) : null;
  return diagram ? `${recording.id}: ${diagram}` : null;
}

/** The answers file for a full set of good results; no file at all when any recording is missing or failed. */
export function assembleDemoAnswers(recordings: DemoRecording[], results: ReadonlyMap<string, RecordingResult>): { file: DemoAnswersFile | null; problems: string[] } {
  const problems = recordings.map((r) => recordingProblem(r, results.get(r.id))).filter((p): p is string => p !== null);
  if (problems.length) return { file: null, problems };
  const text = (id: string) => results.get(id)!.text;
  const explain: Record<string, string> = {};
  for (const r of recordings) if (r.mode === 'explain' && r.element) explain[r.element] = text(r.id);
  return { file: { provisional: false, answers: { overview: text('overview'), document: text('document'), draw: text('draw'), explain } }, problems: [] };
}

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * What an answers file lacks for the demo flow: an empty action, a picker row
 * without an Explain answer, a draw answer without a diagram. It does not judge
 * the provisional flag; the package check does that.
 */
export function demoAnswerProblems(file: unknown, sample: unknown): string[] {
  if (!isRec(file) || typeof file.provisional !== 'boolean' || !isRec(file.answers)) return ['the file is not an object with "provisional" and "answers"'];
  const answers = file.answers;
  const problems: string[] = [];
  for (const action of WHOLE_FLOW_ACTIONS) {
    const text = answers[action];
    if (typeof text !== 'string') problems.push(`${action}: missing`);
    else if (!text.trim()) problems.push(`${action}: empty`);
    else if (action === 'draw' && extractMermaid(text) === null) problems.push('draw: no mermaid block');
  }
  if (!isRec(answers.explain)) return [...problems, 'explain: missing'];
  for (const name of pickerNames(sample)) {
    const text = answers.explain[name];
    if (typeof text !== 'string') problems.push(`explain:${name}: missing`);
    else if (!text.trim()) problems.push(`explain:${name}: empty`);
  }
  return problems;
}
