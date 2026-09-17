import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import syntheticFlow from '../../test/fixtures/synthetic-flow.json';
import type { ActiveFlow } from '@/hooks/useActiveFlow';
import { getChat } from '@/lib/chat-history';
import { setProviderKey } from '@/lib/key-storage';
import type { Chunk, LLMProvider, SendArgs } from '@/lib/providers/types';
import { defaultSettings, type Settings } from '@/lib/settings';

import { stopAllRuns, useChatStream } from './useChatStream';

const flow: ActiveFlow = {
  key: 'chat:00DXXXXXXXXXXXX:300XXXX0000ABCDxyz',
  sfHost: 'mycompany.my.salesforce.com',
  orgId: '00DXXXXXXXXXXXX',
  route: { kind: 'flowVersion', id: '301XXXX0000ABCDxyz' },
  loaded: {
    record: { Id: '301XXXX0000ABCDxyz', VersionNumber: 4, Status: 'Draft', MasterLabel: 'Synthetic Test Flow', DefinitionId: '300XXXX0000ABCDxyz', ProcessType: 'AutoLaunchedFlow', LastModifiedDate: '2026-09-01T10:00:00.000Z', Metadata: syntheticFlow },
    definition: { Id: '300XXXX0000ABCDxyz', ActiveVersionId: null, ActiveVersionNumber: null, LatestVersionId: '301XXXX0000ABCDxyz', LatestVersionNumber: 4 },
  },
  metadata: syntheticFlow,
};

function settingsFor(models: { id: string; maxInputTokens?: number }[] = [{ id: 'claude-sonnet-5', maxInputTokens: 1_000_000 }, { id: 'claude-haiku-4-5-20251001', maxInputTokens: 200_000 }]): Settings {
  const s = defaultSettings();
  return { ...s, activeProvider: 'anthropic', keys: { ...s.keys, anthropic: { status: 'validated', last4: 'wxyz', models, checkedAt: 1 } } };
}

const usage = { inputTokens: 5_000, cachedInputTokens: 0, cacheWriteTokens: 4_000, outputTokens: 20, reasoningTokens: 0 };

/** A provider whose stream is scripted per call; `gate` lets a test hold the stream open. */
function scriptedProvider(script: (call: number, args: SendArgs) => Chunk[], gate?: { release: () => void; wait: Promise<void> }) {
  const calls: SendArgs[] = [];
  const provider: LLMProvider = {
    async *send(args) {
      calls.push(args);
      const chunks = script(calls.length, args);
      for (const chunk of chunks) {
        if (args.signal.aborted) return;
        yield chunk;
        if (gate && chunk.type === 'text') {
          await Promise.race([gate.wait, new Promise<void>((resolve) => args.signal.addEventListener('abort', () => resolve(), { once: true }))]);
          if (args.signal.aborted) return;
        }
      }
    },
  };
  return { provider, calls, make: () => provider };
}

const measurer = async () => ({ tokens: 6_000, exact: false });
const settings = settingsFor();

beforeEach(async () => {
  await setProviderKey('anthropic', 'test-key-wxyz', 'local');
});

// Runs outlive views by design; a test that leaves one alive must not reach the next test.
afterEach(() => stopAllRuns());

describe('useChatStream', () => {
  it('sends the first question with the flow as the cache prefix, streams text, records usage and the stop reason, and persists', async () => {
    const { make, calls } = scriptedProvider(() => [{ type: 'text', text: 'It routes ' }, { type: 'text', text: 'accounts.' }, { type: 'usage', usage }, { type: 'stop', reason: 'end' }]);
    const { result } = renderHook(() => useChatStream({ flow, settings, makeProvider: make, measurer }));
    await waitFor(() => expect(result.current.flowMeasure).not.toBeNull());

    await act(async () => {
      await result.current.send({ mode: 'ask', question: 'What does this flow do?' });
    });
    await waitFor(() => expect(result.current.status).toBe('idle'));
    const [user, answer] = result.current.turns;
    expect(user).toMatchObject({ role: 'user', displayText: 'What does this flow do?', sentText: 'What does this flow do?', mode: 'ask' });
    expect(answer).toMatchObject({ role: 'assistant', displayText: 'It routes accounts.', stopReason: 'end', usage });
    expect(answer?.interrupted).toBeUndefined();
    expect(result.current.hasAnswered).toBe(true);
    expect(result.current.lastReused).toBe(false);

    expect(calls[0]?.messages).toEqual([{ role: 'user', content: 'What does this flow do?' }]);
    expect(calls[0]?.wrappedFlow).toContain('<flow_metadata_json>');
    expect(calls[0]?.apiKey).toBe('test-key-wxyz');
    expect(calls[0]?.model).toEqual({ id: 'claude-sonnet-5', family: 'anthropic-5' });
    expect(calls[0]?.effort).toBe('medium');
    expect(calls[0]?.maxOutputTokens).toBe(16_000);

    const stored = await getChat(flow.key);
    expect(stored?.turns.map((t) => [t.role, t.displayText, t.interrupted ?? null])).toEqual([
      ['user', 'What does this flow do?', null],
      ['assistant', 'It routes accounts.', null],
    ]);
  });

  it('Enter during streaming is ignored (busy guard), Stop keeps the partial labelled Stopped with no error', async () => {
    let release = () => {};
    const gate = { wait: new Promise<void>((r) => (release = r)), release: () => release() };
    const { make, calls } = scriptedProvider(() => [{ type: 'text', text: 'partial' }, { type: 'text', text: ' more' }, { type: 'stop', reason: 'end' }], gate);
    const { result } = renderHook(() => useChatStream({ flow, settings, makeProvider: make, measurer }));
    await waitFor(() => expect(result.current.flowMeasure).not.toBeNull());

    act(() => {
      void result.current.send({ mode: 'ask', question: 'First' });
    });
    await waitFor(() => expect(result.current.status).toBe('streaming'));
    await act(async () => {
      await result.current.send({ mode: 'ask', question: 'Second while busy' });
    });
    expect(calls).toHaveLength(1);
    expect(result.current.turns.filter((t) => t.role === 'user')).toHaveLength(1);

    act(() => result.current.stop());
    await waitFor(() => expect(result.current.status).toBe('idle'));
    const answer = result.current.turns[1]!;
    expect(answer).toMatchObject({ role: 'assistant', displayText: 'partial', interrupted: 'stopped' });
    expect(answer.error).toBeUndefined();
    expect((await getChat(flow.key))?.turns[1]).toMatchObject({ displayText: 'partial', interrupted: 'stopped' });
  });

  it('an error keeps the partial with its class; Retry removes it and re-sends the same question without a duplicate bubble', async () => {
    const { make, calls } = scriptedProvider((call) =>
      call === 1
        ? [{ type: 'text', text: 'half an ' }, { type: 'error', error: { class: 'interrupted' } }]
        : [{ type: 'text', text: 'full answer' }, { type: 'usage', usage }, { type: 'stop', reason: 'end' }],
    );
    const { result } = renderHook(() => useChatStream({ flow, settings, makeProvider: make, measurer }));
    await waitFor(() => expect(result.current.flowMeasure).not.toBeNull());
    await act(async () => {
      await result.current.send({ mode: 'overview', question: '' });
    });
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.turns[1]).toMatchObject({ role: 'assistant', displayText: 'half an ', interrupted: 'error', error: { class: 'interrupted' } });

    await act(async () => {
      await result.current.retry();
    });
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.turns.map((t) => [t.role, t.displayText])).toEqual([
      ['user', ''],
      ['assistant', 'full answer'],
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.messages).toEqual(calls[0]?.messages);
    expect(calls[1]?.messages[0]?.content).toContain('<response_contract mode="overview">');
  });

  it('a stream that cuts off or is declined is labelled by its stop reason', async () => {
    const { make } = scriptedProvider((call) => [{ type: 'text', text: 'x' }, { type: 'usage', usage }, { type: 'stop', reason: call === 1 ? 'max_tokens' : 'refusal' }]);
    const { result } = renderHook(() => useChatStream({ flow, settings, makeProvider: make, measurer }));
    await waitFor(() => expect(result.current.flowMeasure).not.toBeNull());
    await act(async () => {
      await result.current.send({ mode: 'ask', question: 'a' });
    });
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.turns[1]?.stopReason).toBe('max_tokens');
    await act(async () => {
      await result.current.send({ mode: 'ask', question: 'b' });
    });
    await waitFor(() => expect(result.current.turns).toHaveLength(4));
    expect(result.current.turns[3]?.stopReason).toBe('refusal');
  });

  it('blocks a send that will not fit and names the smallest fitting model; the provider is never called', async () => {
    const { make, calls } = scriptedProvider(() => []);
    const settings = settingsFor([{ id: 'claude-haiku-4-5-20251001', maxInputTokens: 200_000 }, { id: 'claude-sonnet-5', maxInputTokens: 1_000_000 }]);
    settings.modelByProvider.anthropic = 'claude-haiku-4-5-20251001';
    const bigMeasurer = async () => ({ tokens: 250_000, exact: true });
    const { result } = renderHook(() => useChatStream({ flow, settings, makeProvider: make, measurer: bigMeasurer }));
    await waitFor(() => expect(result.current.flowMeasure?.tokens).toBe(250_000));
    // Decided before any send attempt (the composer disables Send and shows the notice).
    await waitFor(() => expect(result.current.blocked?.ok).toBe(false));
    await act(async () => {
      await result.current.send({ mode: 'ask', question: 'Hi' });
    });
    expect(result.current.blocked?.ok).toBe(false);
    expect(result.current.blocked?.ok === false && result.current.blocked.suggested?.id).toBe('claude-sonnet-5');
    expect(calls).toHaveLength(0);
    expect(result.current.turns).toHaveLength(0);
  });

  it('flags a mid-chat answer that did not reuse the flow, never the first answer, and nudges once when the chat gets long', async () => {
    const reused = { ...usage, inputTokens: 6_100, cachedInputTokens: 6_000 };
    const cold = { ...usage, inputTokens: 6_100, cachedInputTokens: 0 };
    const long = { ...usage, inputTokens: 700_000, cachedInputTokens: 6_000 };
    const { make } = scriptedProvider((call) => [{ type: 'text', text: 'a' }, { type: 'usage', usage: call === 1 ? cold : call === 2 ? reused : call === 3 ? cold : long }, { type: 'stop', reason: 'end' }]);
    const { result } = renderHook(() => useChatStream({ flow, settings, makeProvider: make, measurer }));
    await waitFor(() => expect(result.current.flowMeasure).not.toBeNull());
    for (const q of ['1', '2', '3', '4']) {
      await act(async () => {
        await result.current.send({ mode: 'ask', question: q });
      });
      await waitFor(() => expect(result.current.status).toBe('idle'));
    }
    const answers = result.current.turns.filter((t) => t.role === 'assistant');
    expect(answers.map((a) => a.reread ?? false)).toEqual([false, false, true, false]);
    expect(result.current.lastReused).toBe(true);
    expect(result.current.nudge).toBe(true);
    act(() => result.current.dismissNudge());
    expect(result.current.nudge).toBe(false);
  });

  it('leaving the flow mid-answer keeps the run going under its own key; the next flow starts clean and idle', async () => {
    let release = () => {};
    const gate = { wait: new Promise<void>((r) => (release = r)), release: () => release() };
    const { make, calls } = scriptedProvider(() => [{ type: 'text', text: 'partial' }, { type: 'text', text: ' more' }, { type: 'stop', reason: 'end' }], gate);
    const { result, rerender } = renderHook((props: { flow: ActiveFlow }) => useChatStream({ flow: props.flow, settings, makeProvider: make, measurer }), { initialProps: { flow } });
    await waitFor(() => expect(result.current.flowMeasure).not.toBeNull());
    act(() => {
      void result.current.send({ mode: 'document', question: '' });
    });
    await waitFor(() => expect(result.current.status).toBe('streaming'));

    const other: ActiveFlow = {
      ...flow,
      key: 'chat:00DXXXXXXXXXXXX:300XXXX0000SECONDx',
      loaded: { ...flow.loaded, record: { ...flow.loaded.record, Id: '301XXXX0000SECONDx', DefinitionId: '300XXXX0000SECONDx', MasterLabel: 'Second' } },
    };
    rerender({ flow: other });
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(calls[0]?.signal.aborted).toBe(false); // the first flow's answer is still coming in
    // The second flow's chat is empty: no leaked partial, and no "Flow updated" notice for a different flow.
    await waitFor(() => expect(result.current.turns).toEqual([]));
    expect(await getChat(other.key)).toBeNull();
    await waitFor(async () =>
      expect((await getChat(flow.key))?.turns.map((t) => [t.role, t.displayText, t.interrupted ?? null])).toEqual([
        ['user', '', null],
        ['assistant', 'partial', 'error'],
      ]),
    ); // the throttled writer catches up

    gate.release();
    await waitFor(async () => expect((await getChat(flow.key))?.turns[1]).toMatchObject({ displayText: 'partial more', stopReason: 'end' }));
    expect((await getChat(flow.key))?.turns[1]?.interrupted).toBeUndefined();
    expect(await getChat(other.key)).toBeNull(); // it finished under its own key
  });

  it('a tab switch does not stop the answer: the run outlives the view, and a view mounting on the same chat picks it up and finishes with it', async () => {
    let release = () => {};
    const gate = { wait: new Promise<void>((r) => (release = r)), release: () => release() };
    const { make, calls } = scriptedProvider(() => [{ type: 'text', text: 'partial' }, { type: 'text', text: ' and the rest' }, { type: 'usage', usage }, { type: 'stop', reason: 'end' }], gate);
    const first = renderHook(() => useChatStream({ flow, settings, makeProvider: make, measurer }));
    await waitFor(() => expect(first.result.current.flowMeasure).not.toBeNull());
    act(() => {
      void first.result.current.send({ mode: 'ask', question: 'Q' });
    });
    await waitFor(() => expect(first.result.current.status).toBe('streaming'));
    first.unmount(); // the panel now shows another tab's state
    await waitFor(async () => expect((await getChat(flow.key))?.turns[1]).toMatchObject({ displayText: 'partial', interrupted: 'error' })); // saved as it goes, still in flight
    expect(calls[0]?.signal.aborted).toBe(false);

    const second = renderHook(() => useChatStream({ flow, settings, makeProvider: make, measurer }));
    await waitFor(() => expect(second.result.current.status).toBe('streaming'));
    expect(second.result.current.turns[1]?.displayText).toBe('partial');
    await act(async () => {
      await second.result.current.send({ mode: 'ask', question: 'while it runs' }); // the busy guard covers a background run
    });
    expect(calls).toHaveLength(1);

    gate.release();
    await waitFor(() => expect(second.result.current.status).toBe('idle'));
    expect(second.result.current.turns.map((t) => [t.role, t.displayText, t.interrupted ?? null])).toEqual([
      ['user', 'Q', null],
      ['assistant', 'partial and the rest', null],
    ]);
    expect(second.result.current.turns[1]?.stopReason).toBe('end');
    expect(second.result.current.lastUsage).toEqual(usage); // stored with the answer, so the chip keeps its numbers
    expect(calls).toHaveLength(1);
  });

  it('if the stream dies while the view is away (the panel was closed), the reopened panel shows the labelled partial and can retry it', async () => {
    let release = () => {};
    const gate = { wait: new Promise<void>((r) => (release = r)), release: () => release() };
    const { make, calls } = scriptedProvider((call) => (call === 1 ? [{ type: 'text', text: 'partial' }, { type: 'error', error: { class: 'interrupted' } }] : [{ type: 'text', text: 'partial and the rest' }, { type: 'usage', usage }, { type: 'stop', reason: 'end' }]), gate);
    const first = renderHook(() => useChatStream({ flow, settings, makeProvider: make, measurer }));
    await waitFor(() => expect(first.result.current.flowMeasure).not.toBeNull());
    act(() => {
      void first.result.current.send({ mode: 'ask', question: 'Q' });
    });
    await waitFor(() => expect(first.result.current.status).toBe('streaming'));
    first.unmount();
    gate.release(); // the connection drops while nobody is looking
    await waitFor(async () => expect((await getChat(flow.key))?.turns[1]).toMatchObject({ displayText: 'partial', interrupted: 'error' }));

    const second = renderHook(() => useChatStream({ flow, settings, makeProvider: make, measurer }));
    await waitFor(() => expect(second.result.current.turns).toHaveLength(2));
    await waitFor(() => expect(second.result.current.status).toBe('idle'));
    expect(second.result.current.turns[1]).toMatchObject({ role: 'assistant', displayText: 'partial', interrupted: 'error' });
    expect(second.result.current.turns[1]?.error).toBeUndefined(); // the class is not stored; the footer still offers Retry
    await act(async () => {
      await second.result.current.retry();
    });
    await waitFor(() => expect(second.result.current.status).toBe('idle'));
    expect(second.result.current.turns.map((t) => [t.role, t.displayText, t.interrupted ?? null])).toEqual([
      ['user', 'Q', null],
      ['assistant', 'partial and the rest', null],
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.messages).toEqual(calls[0]?.messages);
  });

  it('hydrates a stored chat, and New chat clears it', async () => {
    await fakeBrowser.storage.local.set({ [flow.key]: { key: flow.key, turns: [{ role: 'user', displayText: 'old', sentText: 'old', mode: 'ask', timestamp: 1 }, { role: 'assistant', displayText: 'answer', stopReason: 'end', timestamp: 2 }], updatedAt: 2 } });
    const { make } = scriptedProvider(() => []);
    const { result } = renderHook(() => useChatStream({ flow, settings, makeProvider: make, measurer }));
    await waitFor(() => expect(result.current.turns).toHaveLength(2));
    expect(result.current.hasAnswered).toBe(true);
    await act(async () => {
      await result.current.newChat();
    });
    expect(result.current.turns).toEqual([]);
    expect(await getChat(flow.key)).toBeNull();
  });

  it('New chat during an answer leaves nothing in storage, even after the throttled write would have fired', async () => {
    let release = () => {};
    const gate = { wait: new Promise<void>((r) => (release = r)), release: () => release() };
    const { make } = scriptedProvider(() => [{ type: 'text', text: 'partial' }, { type: 'text', text: ' more' }, { type: 'stop', reason: 'end' }], gate);
    const { result } = renderHook(() => useChatStream({ flow, settings, makeProvider: make, measurer }));
    await waitFor(() => expect(result.current.flowMeasure).not.toBeNull());
    act(() => {
      void result.current.send({ mode: 'ask', question: 'First' });
    });
    await waitFor(() => expect(result.current.status).toBe('streaming'));
    await act(async () => {
      await result.current.newChat();
    });
    await waitFor(() => expect(result.current.status).toBe('idle'));
    await new Promise((r) => setTimeout(r, 600)); // past the writer's 400 ms interval
    expect(result.current.turns).toEqual([]);
    expect(await getChat(flow.key)).toBeNull();
  });

  it('stopAllRuns (Forget everything) cancels the pending write too, so a wipe is not undone by a run that was streaming', async () => {
    let release = () => {};
    const gate = { wait: new Promise<void>((r) => (release = r)), release: () => release() };
    const { make } = scriptedProvider(() => [{ type: 'text', text: 'partial' }, { type: 'text', text: ' more' }, { type: 'stop', reason: 'end' }], gate);
    const { result } = renderHook(() => useChatStream({ flow, settings, makeProvider: make, measurer }));
    await waitFor(() => expect(result.current.flowMeasure).not.toBeNull());
    act(() => {
      void result.current.send({ mode: 'ask', question: 'First' });
    });
    await waitFor(() => expect(result.current.status).toBe('streaming'));
    stopAllRuns();
    await fakeBrowser.storage.local.clear();
    await waitFor(() => expect(result.current.status).toBe('idle'));
    await new Promise((r) => setTimeout(r, 600));
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
  });

  it('a Refresh that found a new version posts a notice row', async () => {
    const { make } = scriptedProvider(() => []);
    const { result, rerender } = renderHook((props: { flow: ActiveFlow }) => useChatStream({ flow: props.flow, settings, makeProvider: make, measurer }), { initialProps: { flow } });
    await waitFor(() => expect(result.current.flowMeasure).not.toBeNull());
    const v5: ActiveFlow = { ...flow, loaded: { ...flow.loaded, record: { ...flow.loaded.record, Id: '301XXXX0000LATESTx', VersionNumber: 5, Status: 'Active' } } };
    rerender({ flow: v5 });
    await waitFor(() => expect(result.current.turns.at(-1)).toMatchObject({ role: 'notice', displayText: 'Flow updated to v5 (Active)' }));
  });
});

describe('useChatStream · Draw this flow', () => {
  it('a draw send stores the variant on the user turn and sends the draw contract; Retry keeps the variant', async () => {
    const { make, calls } = scriptedProvider((call) => (call === 1 ? [{ type: 'text', text: 'partial' }, { type: 'error', error: { class: 'interrupted' } }] : [{ type: 'text', text: '```mermaid\nflowchart TD\n  A["Start"] --> B["End"]\n```\nTwo steps.' }, { type: 'stop', reason: 'end' }]));
    const { result } = renderHook(() => useChatStream({ flow, settings, makeProvider: make, measurer }));
    await waitFor(() => expect(result.current.flowMeasure).not.toBeNull());

    await act(async () => {
      await result.current.send({ mode: 'draw', variant: 'admins', question: 'Show every element' });
    });
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.turns[0]).toMatchObject({ role: 'user', mode: 'draw', variant: 'admins', displayText: 'Show every element' });
    expect(calls[0]?.messages[0]?.content).toContain('<response_contract mode="draw" variant="admins">');
    expect(result.current.turns[1]).toMatchObject({ role: 'assistant', interrupted: 'error' });

    await act(async () => {
      await result.current.retry();
    });
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(calls[1]?.messages).toEqual(calls[0]?.messages); // the same assembled turn, variant included
    expect(result.current.turns[0]).toMatchObject({ mode: 'draw', variant: 'admins' });
    expect(result.current.turns[1]?.displayText).toContain('flowchart TD');
    expect((await getChat(flow.key))?.turns[0]).toMatchObject({ mode: 'draw', variant: 'admins' });
  });

  it('redo re-sends the last question even when its answer finished normally (Try again under a diagram that would not draw)', async () => {
    const { make, calls } = scriptedProvider((call) => [{ type: 'text', text: call === 1 ? '```mermaid\nbroken\n```' : '```mermaid\nflowchart TD\n  A --> B\n```' }, { type: 'stop', reason: 'end' }]);
    const { result } = renderHook(() => useChatStream({ flow, settings, makeProvider: make, measurer }));
    await waitFor(() => expect(result.current.flowMeasure).not.toBeNull());
    await act(async () => {
      await result.current.send({ mode: 'draw', question: '' });
    });
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.turns[1]).toMatchObject({ stopReason: 'end' });

    await act(async () => {
      await result.current.retry(); // nothing to retry: the answer was not interrupted
    });
    expect(calls).toHaveLength(1);
    await act(async () => {
      await result.current.redo();
    });
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(calls).toHaveLength(2);
    expect(calls[1]?.messages).toEqual(calls[0]?.messages);
    expect(result.current.turns).toHaveLength(2);
    expect(result.current.turns[1]?.displayText).toContain('flowchart TD');
  });
});
