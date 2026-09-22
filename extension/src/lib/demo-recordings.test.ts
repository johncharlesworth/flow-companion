import { describe, expect, it } from 'vitest';

import answersFile from '@@/test/fixtures/synthetic-demo-answers.json';
import recordedWith from '@@/test/fixtures/synthetic-demo-recorded-with.json';
import sample from '@@/test/fixtures/synthetic-flow.json';

import { assembleDemoAnswers, demoAnswerProblems, demoRecordings, demoSentText, type DemoRecording, recordingProblem, type RecordingResult } from './demo-recordings';
import { normalizeFlow } from './flow-normalizer';
import { buildOutline } from './flow-outline';
import { findSpec, PROVIDERS } from './models';
import { drawContract, RESPONSE_CONTRACTS } from './modes';

const PICKER_ROWS = ['Start', 'CheckCustomerType', 'AssignFollowupOwner', 'CreateFollowupTask', 'UpdateAccount', 'DefaultOwnerVariable', 'AccountAgeInDays', 'IsHighPriorityAccount'];
const DIAGRAM = '```mermaid\nflowchart TD\n  A["One"] --> B{"Two"}\n  B -->|Yes| C["Three"]\n```\nThree boxes.';

const recordings = demoRecordings(sample);
const byId = (id: string): DemoRecording => recordings.find((r) => r.id === id)!;
const good = (): Map<string, RecordingResult> => new Map(recordings.map((r) => [r.id, { text: r.mode === 'draw' ? DIAGRAM : `Answer for ${r.id}.`, stop: 'end' }]));

describe('the bundled demo answers', () => {
  it('cover all four actions and every row of the Explain picker', () => {
    expect(demoAnswerProblems(answersFile, sample)).toEqual([]);
    const rows = buildOutline(normalizeFlow(sample)).groups.flatMap((g) => g.items.map((i) => i.name));
    for (const name of rows) expect((answersFile.answers.explain as Record<string, string>)[name]?.trim(), name).toBeTruthy();
    for (const action of ['overview', 'document', 'draw'] as const) expect(answersFile.answers[action].trim(), action).not.toBe('');
  });

  it('carry a diagram the panel can draw', () => {
    expect(recordingProblem(byId('draw'), { text: answersFile.answers.draw, stop: 'end' })).toBeNull();
  });

  it('name a provider and model the registry knows, by its label', () => {
    expect(PROVIDERS).toContain(recordedWith.provider);
    expect(findSpec(recordedWith.provider as (typeof PROVIDERS)[number], recordedWith.model)?.label).toBe(recordedWith.modelLabel);
    expect(recordedWith.recordedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('demoRecordings', () => {
  it('lists the three whole-flow actions, then one Explain per picker row in picker order', () => {
    expect(recordings.map((r) => r.id)).toEqual(['overview', 'document', 'draw', ...PICKER_ROWS.map((n) => `explain:${n}`)]);
    expect(byId('explain:UpdateAccount')).toEqual({ id: 'explain:UpdateAccount', mode: 'explain', element: 'UpdateAccount' });
    expect(byId('draw')).toEqual({ id: 'draw', mode: 'draw' });
  });

  it('follows the flow it is given, not a fixed list', () => {
    const tiny = { start: { connector: { targetReference: 'OnlyStep' } }, assignments: [{ name: 'OnlyStep', label: 'Only Step' }] };
    expect(demoRecordings(tiny).map((r) => r.id)).toEqual(['overview', 'document', 'draw', 'explain:Start', 'explain:OnlyStep']);
  });
});

describe('demoSentText', () => {
  it('sends each whole-flow action as the panel does with nothing typed', () => {
    expect(demoSentText(byId('overview'), sample)).toBe(`<response_contract mode="overview">\n${RESPONSE_CONTRACTS.overview}\n</response_contract>\n<user_question>\nGive me an overview of this flow.\n</user_question>`);
    expect(demoSentText(byId('document'), sample)).toContain('<user_question>\nDocument this flow.\n</user_question>');
    expect(demoSentText(byId('draw'), sample)).toBe(`<response_contract mode="draw" variant="business">\n${drawContract('business')}\n</response_contract>\n<user_question>\nDraw this flow.\n</user_question>`);
  });

  it('sends Explain with the picked element, what leads into it, and where it goes', () => {
    const text = demoSentText(byId('explain:AssignFollowupOwner'), sample);
    expect(text).toContain('<focus_element name="AssignFollowupOwner">');
    expect(text).toContain('Reached from: CheckCustomerType, CheckCustomerType, UpdateAccount');
    expect(text).toContain('Connects to: CreateFollowupTask');
    expect(text).toContain('<user_question>\nExplain AssignFollowupOwner.\n</user_question>');
    expect(demoSentText(byId('explain:AccountAgeInDays'), sample)).toContain('TODAY() - DATEVALUE');
  });

  it('refuses an element the flow does not have', () => {
    expect(() => demoSentText({ id: 'explain:Nope', mode: 'explain', element: 'Nope' }, sample)).toThrow(/Nope/);
  });
});

describe('recordingProblem', () => {
  it('accepts a finished, non-empty answer', () => {
    expect(recordingProblem(byId('overview'), { text: 'An overview.', stop: 'end' })).toBeNull();
  });

  it('rejects a missing, cut-off, failed, or empty answer', () => {
    expect(recordingProblem(byId('overview'), undefined)).toMatch(/not recorded/);
    expect(recordingProblem(byId('overview'), { text: 'Half an', stop: 'max_tokens' })).toMatch(/max_tokens/);
    expect(recordingProblem(byId('overview'), { text: '', stop: 'error:auth:401' })).toMatch(/error:auth:401/);
    expect(recordingProblem(byId('overview'), { text: ' \n', stop: 'end' })).toMatch(/empty/);
  });

  it('holds the draw answer to one diagram of 3 to 15 nodes', () => {
    expect(recordingProblem(byId('draw'), { text: DIAGRAM, stop: 'end' })).toBeNull();
    expect(recordingProblem(byId('draw'), { text: 'No picture here.', stop: 'end' })).toMatch(/no mermaid block/);
    expect(recordingProblem(byId('draw'), { text: '```mermaid\nflowchart TD\n  A["One"] --> B["Two"]\n```', stop: 'end' })).toMatch(/2 nodes/);
    const many = Array.from({ length: 16 }, (_, i) => `  N${i}["Step ${i}"] --> N${i + 1}["Step ${i + 1}"]`).join('\n');
    expect(recordingProblem(byId('draw'), { text: `\`\`\`mermaid\nflowchart TD\n${many}\n\`\`\``, stop: 'end' })).toMatch(/17 nodes/);
  });
});

describe('assembleDemoAnswers', () => {
  it('builds the file, not provisional, when every recording passed', () => {
    const { file, problems } = assembleDemoAnswers(recordings, good());
    expect(problems).toEqual([]);
    expect(file?.provisional).toBe(false);
    expect(file?.answers.overview).toBe('Answer for overview.');
    expect(file?.answers.draw).toBe(DIAGRAM);
    expect(Object.keys(file?.answers.explain ?? {})).toEqual(PICKER_ROWS);
    expect(demoAnswerProblems(file, sample)).toEqual([]);
  });

  it('builds nothing when any recording is missing or failed', () => {
    const missing = good();
    missing.delete('explain:Start');
    expect(assembleDemoAnswers(recordings, missing)).toEqual({ file: null, problems: ['explain:Start: not recorded'] });

    const cut = good();
    cut.set('document', { text: 'Half a document', stop: 'max_tokens' });
    const outcome = assembleDemoAnswers(recordings, cut);
    expect(outcome.file).toBeNull();
    expect(outcome.problems).toEqual(['document: stopped with max_tokens, not end']);

    expect(assembleDemoAnswers(recordings, new Map()).problems).toHaveLength(recordings.length);
  });
});

describe('demoAnswerProblems', () => {
  const complete = () => assembleDemoAnswers(recordings, good()).file!;

  it('does not judge the provisional flag', () => {
    expect(demoAnswerProblems({ ...complete(), provisional: true }, sample)).toEqual([]);
  });

  it('names an empty action, a missing picker row, and a draw answer without a diagram', () => {
    const file = complete();
    file.answers.document = '  ';
    delete file.answers.explain.UpdateAccount;
    file.answers.draw = 'Words only.';
    expect(demoAnswerProblems(file, sample)).toEqual(['document: empty', 'draw: no mermaid block', 'explain:UpdateAccount: missing']);
  });

  it('rejects a file of the wrong shape', () => {
    expect(demoAnswerProblems(null, sample)).toEqual(['the file is not an object with "provisional" and "answers"']);
    expect(demoAnswerProblems({ provisional: false, answers: { overview: 'x' } }, sample)).toContain('explain: missing');
  });
});
