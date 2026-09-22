// Records the sample flow's demo answers from a real model, so the demo can
// play real answers to someone who has no API key yet. One request per quick
// action (Overview, Document, Draw) and one Explain per row of the sample
// flow's Explain picker, each sent exactly as the panel sends a first turn:
// the normalised flow, the product's prompt assembly and system prompt, the
// product's output budget and effort, nothing typed, no custom instructions.
//
//   ANTHROPIC_API_KEY=… EVAL_PROVIDER=anthropic npm run record-demo
//
// The provider, model, and key are chosen the way the grounding eval chooses
// them (EVAL_PROVIDER, EVAL_MODEL or the provider's default model, and the
// provider's key variable; .env.eval is read when present). The key is read
// from the environment only and is never printed or written.
//
// Only when every recording ends normally with a usable answer are the two
// files written: test/fixtures/synthetic-demo-answers.json (no longer
// provisional) and test/fixtures/synthetic-demo-recorded-with.json. On any
// failure nothing is written and the files on disk stay as they were. Read the
// answers before committing them: they ship inside the package.

import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assembleDemoAnswers, type DemoRecording, demoRecordings, demoSentText, recordingProblem, type RecordingResult } from '@/lib/demo-recordings';
import { demoSample } from '@/lib/demo-sample';
import { normalizeFlow } from '@/lib/flow-normalizer';
import { wrapFlowJson } from '@/lib/flow-wrapper';
import { defaultModel, effortFor, findSpec, type ProviderId, PROVIDERS } from '@/lib/models';
import { capEffortForMode, maxOutputTokensFor } from '@/lib/modes';
import { providerFor } from '@/lib/providers';
import { loadSystemPrompt } from '@/lib/system-prompt';
import sample from '@@/test/fixtures/synthetic-flow.json';

const FIXTURES_DIR = path.join(process.cwd(), 'test/fixtures');
const KEY_ENV: Record<ProviderId, string> = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', google: 'GOOGLE_API_KEY' };
const REQUEST_TIMEOUT_MS = 300_000;

function config(): { provider: ProviderId; model: string; apiKey: string } {
  const provider = process.env.EVAL_PROVIDER as ProviderId | undefined;
  if (!provider || !PROVIDERS.includes(provider)) {
    throw new Error(`Set EVAL_PROVIDER to one of ${PROVIDERS.join(', ')} (got ${JSON.stringify(provider)}).`);
  }
  const apiKey = process.env[KEY_ENV[provider]];
  if (!apiKey) throw new Error(`Set ${KEY_ENV[provider]} to record with ${provider}. The key is read from the environment only; never write it into a file in this repo.`);
  return { provider, model: process.env.EVAL_MODEL ?? defaultModel(provider).id, apiKey };
}

const wrappedFlow = wrapFlowJson(JSON.stringify(normalizeFlow(demoSample(sample))));

async function record(recording: DemoRecording, cfg: ReturnType<typeof config>, system: string): Promise<RecordingResult> {
  const family = findSpec(cfg.provider, cfg.model)?.family ?? 'unknown';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let text = '';
  let stop = 'none';
  try {
    for await (const chunk of providerFor(cfg.provider).send({
      apiKey: cfg.apiKey,
      model: { id: cfg.model, family },
      system,
      wrappedFlow,
      messages: [{ role: 'user', content: demoSentText(recording, sample) }],
      maxOutputTokens: maxOutputTokensFor(recording.mode),
      effort: capEffortForMode(effortFor(family, cfg.model, 'balanced'), recording.mode, family),
      signal: controller.signal,
    })) {
      if (chunk.type === 'text') text += chunk.text;
      else if (chunk.type === 'stop') stop = chunk.reason;
      else if (chunk.type === 'error') stop = `error:${chunk.error.class}${chunk.error.status ? `:${chunk.error.status}` : ''}`;
    }
  } finally {
    clearTimeout(timer);
  }
  return { text, stop };
}

const recordings = demoRecordings(sample);

describe('record the demo answers', () => {
  let cfg: ReturnType<typeof config> | undefined;
  const system = loadSystemPrompt();
  const results = new Map<string, RecordingResult>();

  beforeAll(() => {
    cfg = config();
  });

  afterAll(() => {
    const { file, problems } = assembleDemoAnswers(recordings, results);
    if (!cfg || !file) {
      console.log(`\nNothing written: ${recordings.length - problems.length}/${recordings.length} recordings are usable.${problems.map((p) => `\n  - ${p}`).join('')}`);
      return;
    }
    const answersPath = path.join(FIXTURES_DIR, 'synthetic-demo-answers.json');
    const recordedWithPath = path.join(FIXTURES_DIR, 'synthetic-demo-recorded-with.json');
    const recordedWith = { provider: cfg.provider, model: cfg.model, modelLabel: findSpec(cfg.provider, cfg.model)?.label ?? cfg.model, recordedOn: new Date().toISOString().slice(0, 10) };
    writeFileSync(answersPath, JSON.stringify(file, null, 2) + '\n');
    writeFileSync(recordedWithPath, JSON.stringify(recordedWith, null, 2) + '\n');
    console.log(`\n${recordings.length}/${recordings.length} recorded from ${cfg.provider} ${cfg.model}. Written:\n  ${path.relative(process.cwd(), answersPath)}\n  ${path.relative(process.cwd(), recordedWithPath)}`);
  });

  for (const recording of recordings) {
    it(recording.id, async () => {
      const result = await record(recording, cfg!, system);
      results.set(recording.id, result);
      expect(recordingProblem(recording, result), result.text.slice(0, 2_000)).toBeNull();
    });
  }
});
