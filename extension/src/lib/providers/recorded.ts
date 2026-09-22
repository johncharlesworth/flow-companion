// Plays an answer that was recorded from a real model, in place of a request.
// The demo flow uses it, key or no key, so a person can see what the
// four actions produce before getting one. It is not a provider: it
// has no id, no place in the model registry, and no Settings. It reads no key
// and makes no request; the text comes from a file bundled with the extension,
// loaded on first use so the everyday panel does not carry it.

import type { DemoAnswersFile } from '@/lib/demo-recordings';
import type { ChatMode, DrawVariant } from '@/lib/modes';

import type { Chunk, LLMProvider } from './types';

/** Which recording to play: the action, and for Explain the element's name as the picker hands it over. */
export interface RecordedLookup {
  mode: ChatMode;
  variant?: DrawVariant;
  focusElement?: string;
}

interface RecordedPace {
  /** The wait before the first text, so the waiting row shows as it does for a live answer. */
  firstMs: number;
  /** The wait between chunks. */
  everyMs: number;
  /** Characters per chunk. */
  chars: number;
}

type RecordedAnswers = DemoAnswersFile['answers'];

const DEFAULT_PACE: RecordedPace = { firstMs: 600, everyMs: 16, chars: 14 };

async function loadBundledAnswers(): Promise<RecordedAnswers> {
  const { default: file } = await import('@@/test/fixtures/synthetic-demo-answers.json');
  return file.answers;
}

/** The recorded text for this action, or null when there is none (a typed question, a drawing other than the default one). */
function findAnswer(answers: RecordedAnswers, { mode, variant, focusElement }: RecordedLookup): string | null {
  let text: string | undefined;
  if (mode === 'overview' || mode === 'document') text = answers[mode];
  else if (mode === 'draw' && (variant ?? 'business') === 'business') text = answers.draw;
  else if (mode === 'explain' && focusElement !== undefined && Object.hasOwn(answers.explain, focusElement)) text = answers.explain[focusElement];
  return typeof text === 'string' && text.trim() ? text : null;
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** Resolves after `ms`, or at once on abort; the caller checks the signal afterwards. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

/**
 * An adapter that streams one recorded answer: paced text chunks, then a normal
 * stop. It reports no usage, because nothing was sent and nothing was reused.
 * Everything in the send arguments but the abort signal is ignored. Nothing is
 * yielded after an abort. `loadAnswers` is for tests.
 */
export function recordedProvider(lookup: RecordedLookup, pace: RecordedPace = DEFAULT_PACE, loadAnswers: () => Promise<RecordedAnswers> = loadBundledAnswers): LLMProvider {
  return {
    async *send({ signal }): AsyncGenerator<Chunk> {
      if (signal.aborted) return;
      let answer: string | null;
      try {
        answer = findAnswer(await loadAnswers(), lookup);
      } catch {
        answer = null;
      }
      if (signal.aborted) return;
      if (answer === null) {
        yield { type: 'error', error: { class: 'unknown' } };
        return;
      }

      await pause(pace.firstMs, signal);
      if (signal.aborted) return;
      const step = Math.max(1, Math.floor(pace.chars));
      for (let at = 0; at < answer.length; ) {
        if (at > 0) {
          await pause(pace.everyMs, signal);
          if (signal.aborted) return;
        }
        let end = Math.min(answer.length, at + step);
        if (end < answer.length && isHighSurrogate(answer.charCodeAt(end - 1))) end += 1; // never half an emoji on screen
        yield { type: 'text', text: answer.slice(at, end) };
        if (signal.aborted) return;
        at = end;
      }
      yield { type: 'stop', reason: 'end' };
    },
  };
}
