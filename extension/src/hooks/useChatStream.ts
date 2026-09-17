// The streaming hook: AbortController, busy guard,
// context stop, incremental persistence, and the interruption contract from
// Stop keeps the partial answer labelled "Stopped", saved, with no Retry.
// An error keeps any partial, labelled, with Retry. Retry removes the
// interrupted answer, keeps the same question, and re-sends. Nothing here
// ever retries on its own (invariant 1).
//
// A running answer outlives the view (a real-Chrome
// pass: a glance at another tab used to kill a two-minute document). Runs
// live in a module registry keyed by chat; the panel follows the active tab
// and unmounts this hook, but the run keeps streaming and saving, and a view
// that mounts on the same chat re-attaches to it through storage changes.
// Only closing the panel or the window ends a run early, and that still
// leaves a labelled partial with Retry.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ActiveFlow } from '@/hooks/useActiveFlow';
import { browser } from 'wxt/browser';

import { chatKey, clearChat, createChatWriter, getChat, type StoredChat, type StoredTurn } from '@/lib/chat-history';
import { type ContextGateResult, shouldBlockSend } from '@/lib/context-gate';
import { wrapFlowJson } from '@/lib/flow-wrapper';
import { createFlowMeasurer, estimateTokens, type FlowMeasure, isChatGettingLong, reusedFlow, type UsageReport } from '@/lib/flow-size';
import { getProviderKey } from '@/lib/key-storage';
import { buildPicker, effortFor, findSpec, UNKNOWN_MODEL_INPUT_TOKENS } from '@/lib/models';
import { assembleUserTurn, capEffortForMode, type ChatMode, type DrawVariant, type FocusElement, maxOutputTokensFor } from '@/lib/modes';
import { providerFor } from '@/lib/providers';
import type { ChatError, ChatMessage, LLMProvider, Usage } from '@/lib/providers/types';
import { keyStorageMode, type Settings } from '@/lib/settings';
import { loadSystemPrompt } from '@/lib/system-prompt';

export type ChatStatus = 'idle' | 'waiting' | 'streaming';

export interface ChatTurn extends StoredTurn {
  id: string;
  /** For an assistant turn that failed: the class the UI maps to copy. */
  error?: ChatError;
}

export interface SendArgs {
  mode: ChatMode;
  /** Draw only; defaults to business. */
  variant?: DrawVariant;
  question: string;
  focusElement?: FocusElement;
}

export interface UseChatStreamArgs {
  flow: ActiveFlow;
  settings: Settings;
  /** Injected in tests. */
  makeProvider?: typeof providerFor;
  measurer?: ReturnType<typeof createFlowMeasurer>;
}

export interface UseChatStreamResult {
  turns: ChatTurn[];
  status: ChatStatus;
  /** True after the first answer, until the next send: the composer's placeholder logic uses it. */
  hasAnswered: boolean;
  send: (args: SendArgs) => Promise<void>;
  stop: () => void;
  retry: () => Promise<void>;
  /** Re-sends the last question whatever state its answer is in (Try again under a diagram that would not draw). */
  redo: () => Promise<void>;
  newChat: () => Promise<void>;
  /** The provider's usage for the last finished answer; drives the chip tooltip. */
  lastUsage: Usage | null;
  /** Whether the last answer reused the flow (null before the first answer). */
  lastReused: boolean | null;
  flowMeasure: FlowMeasure | null;
  /** Set when the next send would not fit; cleared by the next successful send or a model change. */
  blocked: ContextGateResult | null;
  nudge: boolean;
  dismissNudge: () => void;
  /** Posts a notice row ("Switched to Opus 5"). */
  notice: (text: string) => void;
}

const SYSTEM = loadSystemPrompt();
const NEXT_TURN_ESTIMATE = 2_000;
/** The abort reason for New chat: the run ends and writes nothing more, so the cleared chat stays cleared. */
const CLEARED = new DOMException('Chat cleared', 'AbortError');

interface LiveRun {
  controller: AbortController;
  /** Settles when the run has written its last word to storage. */
  done: Promise<void>;
  /** Drops the run's pending throttled write, so a wipe is not undone a moment later. */
  cancelWrites: () => void;
}
/** Answers in flight, by chat key. Module state on purpose: it outlives any one view of the chat. */
const liveRuns = new Map<string, LiveRun>();

/** Ends every run in flight and lets none of them write again: "Forget everything on this computer" (and the tests' teardown). */
export function stopAllRuns(): void {
  for (const run of liveRuns.values()) {
    run.cancelWrites();
    run.controller.abort(CLEARED);
  }
  liveRuns.clear();
}

let idCounter = 0;
const nextId = () => `t${Date.now().toString(36)}-${(idCounter += 1)}`;

function toStored(turns: ChatTurn[]): StoredTurn[] {
  return turns.map(({ id: _id, error: _error, ...rest }) => rest);
}

function fromStored(chat: StoredChat | null): ChatTurn[] {
  return (chat?.turns ?? []).map((t) => ({ ...t, id: nextId() }));
}

/** Storage caught up with a run in flight: keep the ids of the turns already on screen so React keeps their nodes. */
function mergeStored(previous: ChatTurn[], chat: StoredChat | null): ChatTurn[] {
  return (chat?.turns ?? []).map((t, i) => ({ ...t, id: previous[i]?.id ?? nextId() }));
}

const lastAnswerUsage = (turns: ChatTurn[]): Usage | null => turns.filter((t) => t.role === 'assistant' && t.usage).at(-1)?.usage ?? null;

/** History as the model sees it: user turns as sent, finished or partial assistant text, never notices or empty answers. */
function toMessages(turns: ChatTurn[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const t of turns) {
    if (t.role === 'user') out.push({ role: 'user', content: t.sentText ?? t.displayText });
    else if (t.role === 'assistant' && t.displayText.trim()) out.push({ role: 'assistant', content: t.displayText });
  }
  // Providers reject two user turns in a row; drop a user turn whose answer was empty.
  return out.filter((m, i) => !(m.role === 'user' && out[i + 1]?.role === 'user'));
}

export function useChatStream({ flow, settings, makeProvider = providerFor, measurer }: UseChatStreamArgs): UseChatStreamResult {
  const key = chatKey(flow.orgId, flow.loaded.record.DefinitionId);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [flowMeasure, setFlowMeasure] = useState<FlowMeasure | null>(null);
  const [blocked, setBlocked] = useState<ContextGateResult | null>(null);
  const [nudge, setNudge] = useState(false);
  const nudgeShownRef = useRef(false);
  const turnsRef = useRef<ChatTurn[]>([]);
  const writerRef = useRef(createChatWriter());
  const measureRef = useRef(measurer ?? createFlowMeasurer());
  const versionRef = useRef({ key, id: flow.loaded.record.Id });
  const keyRef = useRef(key);

  const wrappedFlow = useMemo(() => wrapFlowJson(JSON.stringify(flow.metadata)), [flow.metadata]);
  const provider = settings.activeProvider;
  const modelId = provider ? settings.modelByProvider[provider] : null;
  const storageMode = keyStorageMode(settings);

  const commit = useCallback((next: ChatTurn[]) => {
    turnsRef.current = next;
    setTurns(next);
  }, []);

  // Hydrate on flow change; notice on a version change of the same flow. A run
  // started by an earlier view of this chat keeps writing to storage: follow it.
  useEffect(() => {
    let live = true;
    keyRef.current = key;
    const attached = liveRuns.get(key);
    void getChat(key).then((chat) => {
      if (!live) return;
      commit(fromStored(chat));
      setBlocked(null);
      nudgeShownRef.current = false;
      setNudge(false);
      // Idle unless this chat has a run in flight (a run for the previous flow keeps going under its own key).
      setStatus(attached && liveRuns.get(key) === attached ? (chat?.turns.at(-1)?.displayText ? 'streaming' : 'waiting') : 'idle');
    });
    if (!attached) {
      return () => {
        live = false;
      };
    }
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      const next = changes[key]?.newValue as StoredChat | undefined;
      if (area !== 'local' || !next || !live) return;
      commit(mergeStored(turnsRef.current, next));
      if (next.turns.at(-1)?.displayText) setStatus((s) => (s === 'waiting' ? 'streaming' : s));
    };
    browser.storage.onChanged.addListener(onChanged);
    void attached.done.then(async () => {
      const final = await getChat(key);
      if (!live) return;
      commit(mergeStored(turnsRef.current, final));
      setStatus('idle');
    });
    return () => {
      live = false;
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, [key, commit]);

  // The chip's numbers come from the last finished answer, stored with it, so they survive a return to the flow.
  const lastUsage = useMemo(() => lastAnswerUsage(turns), [turns]);
  const lastReused = useMemo(() => {
    if (!lastUsage || !provider) return null;
    return reusedFlow(lastUsage as UsageReport, flowMeasure?.tokens ?? estimateTokens(SYSTEM + wrappedFlow, provider));
  }, [lastUsage, provider, flowMeasure, wrappedFlow]);

  useEffect(() => {
    const previous = versionRef.current;
    const record = flow.loaded.record;
    versionRef.current = { key, id: record.Id };
    if (previous.key !== key || previous.id === record.Id) return; // a different flow is not a version change
    const notice: ChatTurn = { id: nextId(), role: 'notice', displayText: `Flow updated to v${record.VersionNumber} (${record.Status})`, timestamp: Date.now() };
    commit([...turnsRef.current, notice]);
  }, [key, flow.loaded.record, commit]);

  // Measure the flow once per version (count endpoint when the provider has one).
  useEffect(() => {
    if (!provider || !modelId) return;
    let live = true;
    const controller = new AbortController();
    void (async () => {
      const apiKey = (await getProviderKey(provider, storageMode)) ?? '';
      try {
        const measure = await measureRef.current({ provider, apiKey, model: modelId, system: SYSTEM, userText: wrappedFlow, versionId: flow.loaded.record.Id, signal: controller.signal });
        if (live) setFlowMeasure(measure);
      } catch {
        /* aborted */
      }
    })();
    return () => {
      live = false;
      controller.abort();
    };
  }, [provider, modelId, wrappedFlow, flow.loaded.record.Id, storageMode]);

  // The hard stop is decided before the user tries to send:
  // whenever the flow's measure, the model, or the transcript changes.
  useEffect(() => {
    if (!provider || !modelId || !flowMeasure) {
      setBlocked(null);
      return;
    }
    const picker = buildPicker(provider, settings.keys[provider].models, null);
    const item = [...picker.recommended, ...picker.more].find((m) => m.id === modelId);
    const maxInputTokens = item?.maxInputTokens ?? findSpec(provider, modelId)?.maxInputTokens ?? UNKNOWN_MODEL_INPUT_TOKENS;
    const transcriptTokens = toMessages(turns).reduce((sum, m) => sum + estimateTokens(m.content, provider), 0);
    const gate = shouldBlockSend({
      maxInputTokens,
      systemTokens: 0,
      flowTokens: flowMeasure.tokens,
      transcriptTokens,
      assembledTurnTokens: NEXT_TURN_ESTIMATE,
      maxOutputTokens: maxOutputTokensFor('ask'),
      currentModelId: modelId,
      candidates: [...picker.recommended, ...picker.more].map((m) => ({ id: m.id, label: m.label, maxInputTokens: m.maxInputTokens })),
    });
    setBlocked(gate.ok ? null : gate);
  }, [provider, modelId, flowMeasure, turns, settings.keys]);

  const persist = useCallback(
    (next: ChatTurn[], now = false) => {
      const chat: StoredChat = { key, turns: toStored(next), updatedAt: Date.now() };
      if (now) void writerRef.current.flushNow(chat);
      else writerRef.current.write(chat);
    },
    [key],
  );

  const run = useCallback(
    async (userTurn: ChatTurn, mode: ChatMode) => {
      if (!provider || !modelId) return;
      const spec = findSpec(provider, modelId);
      const live = settings.keys[provider].models;
      const picker = buildPicker(provider, live, null);
      const item = [...picker.recommended, ...picker.more].find((m) => m.id === modelId);
      const family = item?.family ?? spec?.family ?? 'unknown';
      const maxInputTokens = item?.maxInputTokens ?? spec?.maxInputTokens ?? UNKNOWN_MODEL_INPUT_TOKENS;
      const maxOutputTokens = maxOutputTokensFor(mode);

      const history = toMessages(turnsRef.current);
      const messages = [...history, { role: 'user' as const, content: userTurn.sentText ?? userTurn.displayText }];
      const flowTokens = flowMeasure?.tokens ?? estimateTokens(SYSTEM + wrappedFlow, provider);
      const transcriptTokens = history.reduce((sum, m) => sum + estimateTokens(m.content, provider), 0);
      const gate = shouldBlockSend({
        maxInputTokens,
        systemTokens: 0, // counted inside flowTokens (the measure covers system + flow)
        flowTokens,
        transcriptTokens,
        assembledTurnTokens: estimateTokens(messages[messages.length - 1]!.content, provider),
        maxOutputTokens,
        currentModelId: modelId,
        candidates: [...picker.recommended, ...picker.more].map((m) => ({ id: m.id, label: m.label, maxInputTokens: m.maxInputTokens })),
      });
      if (!gate.ok) {
        setBlocked(gate);
        return;
      }
      setBlocked(null);

      const apiKey = await getProviderKey(provider, storageMode);
      const assistant: ChatTurn = { id: nextId(), role: 'assistant', displayText: '', interrupted: 'error', timestamp: Date.now() };
      const base = [...turnsRef.current, userTurn, assistant];
      commit(base);
      persist(base, true);
      setStatus('waiting');

      if (!apiKey) {
        const failed = base.map((t) => (t.id === assistant.id ? { ...t, error: { class: 'keyRejected' as const } } : t));
        commit(failed);
        persist(failed, true);
        setStatus('idle');
        return;
      }

      const runKey = key;
      const controller = new AbortController();
      let settle = () => {};
      const liveRun: LiveRun = { controller, done: new Promise<void>((resolve) => (settle = resolve)), cancelWrites: () => writerRef.current.cancel() };
      liveRuns.set(runKey, liveRun);
      const finishRun = () => {
        if (liveRuns.get(runKey) === liveRun) liveRuns.delete(runKey);
        settle();
      };
      const llm: LLMProvider = makeProvider(provider);
      let text = '';
      let usage: Usage | null = null;
      let outcome: 'end' | 'max_tokens' | 'refusal' | 'error' | 'stopped' = 'error';
      let error: ChatError | undefined;

      // This run's own view of the transcript, for persisting after the panel
      // has moved to another flow (the live transcript then belongs to that flow).
      let own = base;
      const update = (patch: Partial<ChatTurn>): ChatTurn[] | null => {
        const stale = keyRef.current !== runKey;
        const source = stale ? own : turnsRef.current;
        if (!source.some((t) => t.id === assistant.id)) return null; // New chat cleared it
        const next = source.map((t) => (t.id === assistant.id ? { ...t, ...patch } : t));
        own = next;
        if (!stale) commit(next);
        return next;
      };

      try {
        for await (const chunk of llm.send({
          apiKey,
          model: { id: modelId, family },
          system: SYSTEM,
          wrappedFlow,
          messages,
          maxOutputTokens,
          effort: capEffortForMode(effortFor(family, modelId, settings.detail), mode, family),
          signal: controller.signal,
        })) {
          if (controller.signal.aborted) break;
          if (chunk.type === 'text') {
            text += chunk.text;
            setStatus('streaming');
            const next = update({ displayText: text });
            if (next) persist(next);
          } else if (chunk.type === 'usage') {
            usage = chunk.usage;
          } else if (chunk.type === 'stop') {
            outcome = chunk.reason;
          } else if (chunk.type === 'error') {
            error = chunk.error;
            outcome = 'error';
          }
        }
      } catch {
        outcome = 'error';
        error = { class: 'interrupted' };
      }
      if (controller.signal.aborted) outcome = 'stopped';
      if (controller.signal.reason === CLEARED) {
        // New chat or Forget everything: the chat is gone; write nothing more, not even what was already queued.
        writerRef.current.cancel();
        finishRun();
        setStatus('idle');
        return;
      }

      const finished: Partial<ChatTurn> = { displayText: text, timestamp: Date.now(), ...(usage ? { usage } : {}) };
      if (outcome === 'stopped') Object.assign(finished, { interrupted: 'stopped' });
      else if (outcome === 'error') Object.assign(finished, { interrupted: 'error', error: error ?? { class: 'unknown' } });
      else Object.assign(finished, { interrupted: undefined, stopReason: outcome });

      if (usage) {
        const flowSize = flowMeasure?.tokens ?? flowTokens;
        const reused = reusedFlow(usage as UsageReport, flowSize);
        const isFirstAnswer = history.length === 0;
        if (!isFirstAnswer && !reused) finished.reread = true;
        if (keyRef.current === runKey && !nudgeShownRef.current && isChatGettingLong({ lastInputTokens: usage.inputTokens, nextTurnEstimate: NEXT_TURN_ESTIMATE, outputBudget: maxOutputTokens, maxInputTokens })) {
          nudgeShownRef.current = true;
          setNudge(true);
        }
      }
      const done = update(finished);
      if (done) await writerRef.current.flushNow({ key: runKey, turns: toStored(done), updatedAt: Date.now() });
      finishRun();
      setStatus('idle');
    },
    [key, provider, modelId, settings, storageMode, flowMeasure, wrappedFlow, makeProvider, commit, persist],
  );

  const send = useCallback(
    async ({ mode, variant, question, focusElement }: SendArgs) => {
      if (status !== 'idle' || liveRuns.has(key)) return; // busy guard: Enter during streaming is ignored, a background run too
      const assembled = assembleUserTurn({ mode, variant, question, focusElement, preferences: settings.customInstructions });
      if (!assembled.sentText.trim()) return;
      const userTurn: ChatTurn = {
        id: nextId(),
        role: 'user',
        displayText: assembled.displayText,
        sentText: assembled.sentText,
        mode,
        ...(mode === 'draw' ? { variant: variant ?? 'business' } : {}),
        ...(focusElement ? { focusElement: focusElement.name } : {}),
        timestamp: Date.now(),
      };
      await run(userTurn, mode);
    },
    [status, settings.customInstructions, run, key],
  );

  const stop = useCallback(() => {
    liveRuns.get(key)?.controller.abort(new DOMException('Stopped by the user', 'AbortError'));
  }, [key]);

  const resend = useCallback(
    async (onlyInterrupted: boolean) => {
      if (status !== 'idle' || liveRuns.has(key)) return;
      const current = turnsRef.current;
      const last = current[current.length - 1];
      if (!last || last.role !== 'assistant') return;
      if (onlyInterrupted && last.interrupted !== 'error') return;
      const userIndex = current.length - 2;
      const userTurn = current[userIndex];
      if (!userTurn || userTurn.role !== 'user') return;
      // Remove the answer and the question; run adds the same question back (no duplicate bubble).
      commit(current.slice(0, userIndex));
      await run({ ...userTurn, id: nextId(), timestamp: Date.now() }, userTurn.mode ?? 'ask');
    },
    [status, run, commit, key],
  );
  const retry = useCallback(() => resend(true), [resend]);
  const redo = useCallback(() => resend(false), [resend]);

  const newChat = useCallback(async () => {
    liveRuns.get(key)?.controller.abort(CLEARED);
    writerRef.current.cancel(); // a throttled write from the run must not land after the clear
    commit([]);
    await clearChat(key);
    setBlocked(null);
    nudgeShownRef.current = false;
    setNudge(false);
  }, [key, commit]);

  const notice = useCallback(
    (text: string) => {
      const next = [...turnsRef.current, { id: nextId(), role: 'notice' as const, displayText: text, timestamp: Date.now() }];
      commit(next);
      persist(next, true);
    },
    [commit, persist],
  );

  const hasAnswered = turns.some((t) => t.role === 'assistant' && !t.interrupted && t.displayText.length > 0);

  return { turns, status, hasAnswered, send, stop, retry, redo, newChat, lastUsage, lastReused, flowMeasure, blocked, nudge, dismissNudge: () => setNudge(false), notice };
}

