// Per-flow chat history in chrome.storage.local. Keyed by
// the fetched record's FlowDefinition id, never the URL's version id, so a
// chat survives saving a new version. Written as the stream arrives; the last
// message stays flagged interrupted until the answer finishes, so closing the
// panel mid-answer leaves a labelled partial with Retry.

import { browser } from 'wxt/browser';

import type { StopReason, Usage } from './providers/types';

export type ChatMode = 'ask' | 'overview' | 'explain' | 'document' | 'draw';
/** Draw this flow: business readers by default, every element for admins, or the picture around one element. */
export type DrawVariant = 'business' | 'admins' | 'fromElement';

export interface StoredTurn {
  role: 'user' | 'assistant' | 'notice';
  /** What the transcript shows. */
  displayText: string;
  /** For user turns: the assembled text sent to the model (no flow block), so replay is byte-identical. */
  sentText?: string;
  mode?: ChatMode;
  /** For draw turns: which picture was asked for. */
  variant?: DrawVariant;
  focusElement?: string;
  /** For assistant turns. Absent while streaming. */
  stopReason?: StopReason;
  /** The answer did not finish normally: stopped by the user, or an error/close mid-stream. */
  interrupted?: 'stopped' | 'error';
  /** The provider re-read the whole flow for this answer (mid-chat, no reuse). */
  reread?: boolean;
  /** The provider's usage report for a finished answer, so the flow chip's numbers survive a tab switch or a reopened panel. */
  usage?: Usage;
  timestamp: number;
}

export interface StoredChat {
  key: string;
  turns: StoredTurn[];
  updatedAt: number;
}

export const CHAT_KEY_PREFIX = 'chat:';
export const PER_CHAT_CAP_BYTES = 200 * 1024;
export const GLOBAL_CAP_BYTES = 5 * 1024 * 1024;

export function chatKey(orgId: string | null, definitionId: string): string {
  return `${CHAT_KEY_PREFIX}${orgId ?? 'unknown'}:${definitionId}`;
}

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

/** Drops the oldest turns (in pairs, from the front) until the chat fits the per-chat cap. Storage only; the panel keeps the full transcript in memory. */
export function trimToCap(chat: StoredChat, cap: number = PER_CHAT_CAP_BYTES): StoredChat {
  let turns = chat.turns;
  while (turns.length > 2 && bytes({ ...chat, turns }) > cap) turns = turns.slice(2);
  return turns === chat.turns ? chat : { ...chat, turns };
}

export async function getChat(key: string): Promise<StoredChat | null> {
  const stored = await browser.storage.local.get(key);
  const value = stored[key] as StoredChat | undefined;
  return value && Array.isArray(value.turns) ? value : null;
}

/**
 * Saves a chat, trimmed to the per-chat cap, then evicts the least recently
 * updated other chats until everything fits the global cap. Quota errors are
 * swallowed: the transcript stays in memory.
 */
export async function saveChat(chat: StoredChat): Promise<void> {
  const trimmed = trimToCap({ ...chat, updatedAt: Date.now() });
  try {
    await browser.storage.local.set({ [chat.key]: trimmed });
    await evictToGlobalCap(chat.key);
  } catch {
    /* quota or storage failure: keep the transcript in memory only */
  }
}

async function evictToGlobalCap(keep: string): Promise<void> {
  const all = await browser.storage.local.get(null);
  const chats = Object.entries(all)
    .filter(([k]) => k.startsWith(CHAT_KEY_PREFIX))
    .map(([k, v]) => ({ key: k, updatedAt: (v as StoredChat).updatedAt ?? 0, size: bytes(v) }));
  let total = chats.reduce((sum, c) => sum + c.size, 0);
  if (total <= GLOBAL_CAP_BYTES) return;
  const victims = chats.filter((c) => c.key !== keep).sort((a, b) => a.updatedAt - b.updatedAt);
  const remove: string[] = [];
  for (const v of victims) {
    if (total <= GLOBAL_CAP_BYTES) break;
    remove.push(v.key);
    total -= v.size;
  }
  if (remove.length) await browser.storage.local.remove(remove);
}

export async function clearChat(key: string): Promise<void> {
  await browser.storage.local.remove(key);
}

/**
 * A throttled writer: coalesces stream writes to at most one per interval,
 * always flushing the latest. `cancel` drops whatever is waiting, so a chat
 * that was just cleared is not written back by a write scheduled before.
 */
export function createChatWriter(intervalMs = 400) {
  let pending: StoredChat | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  const flush = async () => {
    const chat = pending;
    cancel();
    if (chat) await saveChat(chat);
  };
  return {
    write(chat: StoredChat) {
      pending = chat;
      if (!timer) timer = setTimeout(() => void flush(), intervalMs);
    },
    async flushNow(chat?: StoredChat) {
      if (chat) pending = chat;
      await flush();
    },
    cancel,
  };
}
