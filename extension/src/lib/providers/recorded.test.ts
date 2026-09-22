import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DemoAnswersFile } from '@/lib/demo-recordings';

import { recordedProvider } from './recorded';
import type { Chunk, SendArgs } from './types';

const OVERVIEW = 'This flow routes accounts by tier and then creates a follow-up task.'; // 68 characters
const answers: DemoAnswersFile['answers'] = {
  overview: OVERVIEW,
  document: '# The flow\n\nA document.',
  draw: '```mermaid\nflowchart TD\n  A["Start"] --> B["End"]\n```\nTwo steps.',
  explain: { CheckCustomerType: 'It sorts accounts by type.' },
};
const load = async () => answers;
const FAST = { firstMs: 0, everyMs: 0, chars: 14 };

function args(signal: AbortSignal = new AbortController().signal): SendArgs {
  return { apiKey: '', model: { id: 'any', family: 'unknown' }, system: '', wrappedFlow: '', messages: [], maxOutputTokens: 1, effort: null, signal };
}

async function collect(stream: AsyncIterable<Chunk>): Promise<Chunk[]> {
  const out: Chunk[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

const textOf = (chunks: Chunk[]) => chunks.map((c) => (c.type === 'text' ? c.text : '')).join('');

afterEach(() => {
  vi.useRealTimers();
});

describe('recordedProvider', () => {
  it('plays the recorded answer as small text chunks, then a normal stop, and never a usage chunk', async () => {
    const chunks = await collect(recordedProvider({ mode: 'overview' }, FAST, load).send(args()));
    const texts = chunks.filter((c) => c.type === 'text');
    expect(texts).toHaveLength(Math.ceil(OVERVIEW.length / 14));
    expect(texts.every((c) => c.type === 'text' && c.text.length <= 14)).toBe(true);
    expect(textOf(chunks)).toBe(OVERVIEW);
    expect(chunks.at(-1)).toEqual({ type: 'stop', reason: 'end' });
    expect(chunks.filter((c) => c.type === 'stop')).toHaveLength(1);
    expect(chunks.some((c) => c.type === 'usage')).toBe(false);
    expect(chunks.some((c) => c.type === 'error')).toBe(false);
  });

  it('finds each action by its mode, the default drawing, and Explain by the element name', async () => {
    const play = async (lookup: Parameters<typeof recordedProvider>[0]) => textOf(await collect(recordedProvider(lookup, FAST, load).send(args())));
    expect(await play({ mode: 'document' })).toBe(answers.document);
    expect(await play({ mode: 'draw' })).toBe(answers.draw);
    expect(await play({ mode: 'draw', variant: 'business' })).toBe(answers.draw);
    expect(await play({ mode: 'explain', focusElement: 'CheckCustomerType' })).toBe(answers.explain.CheckCustomerType);
  });

  it('never splits a character that takes two code units across chunks', async () => {
    const emoji = async () => ({ ...answers, overview: 'ab\u{1F600}cd' });
    const chunks = await collect(recordedProvider({ mode: 'overview' }, { firstMs: 0, everyMs: 0, chars: 3 }, emoji).send(args()));
    expect(chunks.filter((c) => c.type === 'text').map((c) => (c.type === 'text' ? c.text : ''))).toEqual(['ab\u{1F600}', 'cd']);
  });

  it('a missing recording is one error chunk and nothing else', async () => {
    const missing: Parameters<typeof recordedProvider>[0][] = [
      { mode: 'ask' },
      { mode: 'explain' },
      { mode: 'explain', focusElement: 'NoSuchElement' },
      { mode: 'explain', focusElement: 'constructor' },
      { mode: 'draw', variant: 'admins' },
      { mode: 'draw', variant: 'fromElement', focusElement: 'CheckCustomerType' },
    ];
    for (const lookup of missing) {
      expect(await collect(recordedProvider(lookup, FAST, load).send(args()))).toEqual([{ type: 'error', error: { class: 'unknown' } }]);
    }
    const empty = async () => ({ ...answers, overview: '   ' });
    expect(await collect(recordedProvider({ mode: 'overview' }, FAST, empty).send(args()))).toEqual([{ type: 'error', error: { class: 'unknown' } }]);
  });

  it('answers that cannot be loaded are an error chunk, not a throw', async () => {
    const broken = async () => {
      throw new Error('chunk failed to load');
    };
    expect(await collect(recordedProvider({ mode: 'overview' }, FAST, broken).send(args()))).toEqual([{ type: 'error', error: { class: 'unknown' } }]);
  });

  it('waits before the first chunk and between chunks at the given pace', async () => {
    vi.useFakeTimers();
    const chunks: Chunk[] = [];
    const done = (async () => {
      for await (const chunk of recordedProvider({ mode: 'overview' }, { firstMs: 600, everyMs: 16, chars: 14 }, load).send(args())) chunks.push(chunk);
    })();
    await vi.advanceTimersByTimeAsync(599);
    expect(chunks).toHaveLength(0); // the waiting row shows
    await vi.advanceTimersByTimeAsync(1);
    expect(chunks).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(16);
    expect(chunks).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(16 * 10);
    await done;
    expect(textOf(chunks)).toBe(OVERVIEW);
    expect(chunks.at(-1)).toEqual({ type: 'stop', reason: 'end' });
  });

  it('an abort mid-stream ends the wait early and yields nothing more, not even a stop', async () => {
    const controller = new AbortController();
    const chunks: Chunk[] = [];
    // A pace no test would sit through: only the abort can end this stream.
    for await (const chunk of recordedProvider({ mode: 'overview' }, { firstMs: 0, everyMs: 60_000, chars: 14 }, load).send(args(controller.signal))) {
      chunks.push(chunk);
      if (chunks.length === 1) setTimeout(() => controller.abort(), 0);
    }
    expect(chunks).toEqual([{ type: 'text', text: OVERVIEW.slice(0, 14) }]);
  });

  it('an abort during the first wait, or before the send, yields nothing at all', async () => {
    const during = new AbortController();
    setTimeout(() => during.abort(), 0);
    expect(await collect(recordedProvider({ mode: 'overview' }, { firstMs: 60_000, everyMs: 0, chars: 14 }, load).send(args(during.signal)))).toEqual([]);

    const before = new AbortController();
    before.abort();
    expect(await collect(recordedProvider({ mode: 'overview' }, FAST, load).send(args(before.signal)))).toEqual([]);
  });

  it('plays the bundled answers by default and makes no request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('recorded mode must not use the network'));
    const chunks = await collect(recordedProvider({ mode: 'overview' }, FAST).send(args()));
    expect(textOf(chunks).length).toBeGreaterThan(0);
    expect(chunks.at(-1)).toEqual({ type: 'stop', reason: 'end' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
