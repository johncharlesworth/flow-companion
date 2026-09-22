import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import syntheticFlow from '../../test/fixtures/synthetic-flow.json';
import recordedWith from '../../test/fixtures/synthetic-demo-recorded-with.json';
import type { ActiveFlow } from '@/hooks/useActiveFlow';
import { getChat } from '@/lib/chat-history';
import { getProviderKey } from '@/lib/key-storage';
import { providerFor } from '@/lib/providers';
import { defaultSettings } from '@/lib/settings';

import { stopAllRuns, useChatStream } from './useChatStream';

const ANSWERS = {
  overview: 'This flow routes accounts by tier and then creates a follow-up task.',
  document: '# The flow\n\nA document of the demo flow.',
  draw: '```mermaid\nflowchart TD\n  A["Start"] --> B["End"]\n```\nTwo steps.',
  explain: { CheckCustomerType: 'It sorts accounts by type.' } as Record<string, string>,
};

const pace = vi.hoisted(() => ({ firstMs: 0, everyMs: 0, chars: 14 }));

// The real adapter, with answers of the test's own and no waiting: the bundled
// answers change whenever they are re-recorded, and their pace is for people.
vi.mock('@/lib/providers/recorded', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/providers/recorded')>();
  return {
    ...real,
    recordedProvider: (lookup: Parameters<typeof real.recordedProvider>[0]) => real.recordedProvider(lookup, { ...pace }, async () => ANSWERS),
  };
});

// Reading the key must not even be attempted in recorded mode.
vi.mock('@/lib/key-storage', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/key-storage')>();
  return { ...real, getProviderKey: vi.fn(real.getProviderKey) };
});

const flow: ActiveFlow = {
  key: 'chat:demo:300XXXX0000ABCDxyz',
  sfHost: 'demo',
  orgId: 'demo',
  route: { kind: 'flowVersion', id: '301XXXX0000ABCDxyz' },
  loaded: {
    record: { Id: '301XXXX0000ABCDxyz', VersionNumber: 4, Status: 'Active', MasterLabel: 'Synthetic Test Flow', DefinitionId: '300XXXX0000ABCDxyz', ProcessType: 'AutoLaunchedFlow', LastModifiedDate: '2026-09-01T10:00:00.000Z', Metadata: syntheticFlow },
    definition: { Id: '300XXXX0000ABCDxyz', ActiveVersionId: null, ActiveVersionNumber: null, LatestVersionId: '301XXXX0000ABCDxyz', LatestVersionNumber: 4 },
  },
  metadata: syntheticFlow,
};
const RECORDED_KEY = 'chat:demo-recorded:300XXXX0000ABCDxyz';

// First run: no provider chosen, no key anywhere.
const settings = defaultSettings();

const makeProvider = vi.fn(providerFor);
const measurer = vi.fn(async () => ({ tokens: 6_000, exact: true }));
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  pace.everyMs = 0;
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('recorded mode must not use the network'));
  makeProvider.mockClear();
  measurer.mockClear();
  vi.mocked(getProviderKey).mockClear();
});

afterEach(() => stopAllRuns());

describe('useChatStream · recorded', () => {
  it('with no key and no provider chosen, an Overview turn plays to a normal end under the chat’s own recorded key, with no request, no key read, and no measure', async () => {
    const { result } = renderHook(() => useChatStream({ flow, settings, recorded: true, makeProvider, measurer }));
    await act(async () => {
      await result.current.send({ mode: 'overview', question: '' });
    });
    await waitFor(() => expect(result.current.status).toBe('idle'));

    const [user, answer] = result.current.turns;
    expect(user).toMatchObject({ role: 'user', displayText: '', mode: 'overview' });
    expect(answer).toMatchObject({ role: 'assistant', displayText: ANSWERS.overview, stopReason: 'end' });
    expect(answer?.interrupted).toBeUndefined();
    expect(answer?.error).toBeUndefined();
    expect(answer?.usage).toBeUndefined();
    expect(result.current.hasAnswered).toBe(true);
    expect(result.current.blocked).toBeNull();
    expect(result.current.flowMeasure).toBeNull();
    expect(result.current.lastUsage).toBeNull();

    const stored = await fakeBrowser.storage.local.get(null);
    expect(Object.keys(stored).filter((k) => k.startsWith('chat:'))).toEqual([RECORDED_KEY]);
    expect((await getChat(RECORDED_KEY))?.turns.map((t) => [t.role, t.displayText, t.stopReason ?? null])).toEqual([
      ['user', '', null],
      ['assistant', ANSWERS.overview, 'end'],
    ]);
    expect(await getChat(flow.key)).toBeNull(); // the live demo chat is untouched

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getProviderKey).not.toHaveBeenCalled();
    expect(measurer).not.toHaveBeenCalled();
    expect(makeProvider).not.toHaveBeenCalled();
  });

  it('a second action raises no re-read flag and no long-chat nudge', async () => {
    const { result } = renderHook(() => useChatStream({ flow, settings, recorded: true, makeProvider, measurer }));
    for (const mode of ['overview', 'document'] as const) {
      await act(async () => {
        await result.current.send({ mode, question: '' });
      });
      await waitFor(() => expect(result.current.status).toBe('idle'));
    }
    const answers = result.current.turns.filter((t) => t.role === 'assistant');
    expect(answers.map((a) => [a.displayText, a.stopReason, a.reread ?? false])).toEqual([
      [ANSWERS.overview, 'end', false],
      [ANSWERS.document, 'end', false],
    ]);
    expect(result.current.nudge).toBe(false);
    expect(result.current.lastReused).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Explain finds its answer by the element name, Draw by the stored variant, and Try again plays the same recording', async () => {
    const { result } = renderHook(() => useChatStream({ flow, settings, recorded: true }));
    await act(async () => {
      await result.current.send({ mode: 'explain', question: '', focusElement: { name: 'CheckCustomerType', json: {}, before: [], after: [] } });
    });
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.turns[0]).toMatchObject({ mode: 'explain', focusElement: 'CheckCustomerType' });
    expect(result.current.turns[1]).toMatchObject({ displayText: ANSWERS.explain.CheckCustomerType, stopReason: 'end' });

    await act(async () => {
      await result.current.send({ mode: 'draw', question: '' });
    });
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.turns[2]).toMatchObject({ mode: 'draw', variant: 'business' });
    expect(result.current.turns[3]).toMatchObject({ displayText: ANSWERS.draw, stopReason: 'end' });

    await act(async () => {
      await result.current.redo();
    });
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.turns).toHaveLength(4);
    expect(result.current.turns[3]).toMatchObject({ displayText: ANSWERS.draw, stopReason: 'end' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a question with no recording ends as an error, still without a request', async () => {
    const { result } = renderHook(() => useChatStream({ flow, settings, recorded: true }));
    await act(async () => {
      await result.current.send({ mode: 'ask', question: 'What does this flow do?' });
    });
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.turns[1]).toMatchObject({ role: 'assistant', displayText: '', interrupted: 'error', error: { class: 'unknown' } });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getProviderKey).not.toHaveBeenCalled();
  });

  it('Stop keeps the partial answer labelled Stopped', async () => {
    pace.everyMs = 60_000; // only Stop can end this answer
    const { result } = renderHook(() => useChatStream({ flow, settings, recorded: true }));
    act(() => {
      void result.current.send({ mode: 'overview', question: '' });
    });
    await waitFor(() => expect(result.current.status).toBe('streaming'));
    act(() => result.current.stop());
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.turns[1]).toMatchObject({ role: 'assistant', displayText: ANSWERS.overview.slice(0, 14), interrupted: 'stopped' });
    expect(result.current.turns[1]?.stopReason).toBeUndefined();
    expect((await getChat(RECORDED_KEY))?.turns[1]).toMatchObject({ displayText: ANSWERS.overview.slice(0, 14), interrupted: 'stopped' });
  });

  it('New chat clears the recorded chat', async () => {
    const { result } = renderHook(() => useChatStream({ flow, settings, recorded: true }));
    await act(async () => {
      await result.current.send({ mode: 'overview', question: '' });
    });
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(await getChat(RECORDED_KEY)).not.toBeNull();
    await act(async () => {
      await result.current.newChat();
    });
    expect(result.current.turns).toEqual([]);
    expect(await getChat(RECORDED_KEY)).toBeNull();
  });

  it('a chat stored by the live demo is not shown in recorded mode, and recorded turns are not shown once the demo is live', async () => {
    await fakeBrowser.storage.local.set({ [flow.key]: { key: flow.key, turns: [{ role: 'user', displayText: 'live question', sentText: 'live question', mode: 'ask', timestamp: 1 }, { role: 'assistant', displayText: 'live answer', stopReason: 'end', timestamp: 2 }], updatedAt: 2 } });
    const recorded = renderHook(() => useChatStream({ flow, settings, recorded: true }));
    await act(async () => {
      await recorded.result.current.send({ mode: 'overview', question: '' });
    });
    await waitFor(() => expect(recorded.result.current.status).toBe('idle'));
    expect(recorded.result.current.turns.map((t) => t.displayText)).toEqual(['', ANSWERS.overview]);
    recorded.unmount();

    const live = renderHook(() => useChatStream({ flow, settings, measurer }));
    await waitFor(() => expect(live.result.current.turns).toHaveLength(2));
    expect(live.result.current.turns.map((t) => t.displayText)).toEqual(['live question', 'live answer']);
  });

  it('the recorded-with file names a real provider and a model (the values change with each recording)', () => {
    expect(['anthropic', 'openai', 'google']).toContain(recordedWith.provider);
    expect(typeof recordedWith.model).toBe('string');
    expect(recordedWith.model.length).toBeGreaterThan(0);
  });
});
