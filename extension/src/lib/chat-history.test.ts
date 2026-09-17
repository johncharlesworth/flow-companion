import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { chatKey, clearChat, createChatWriter, getChat, GLOBAL_CAP_BYTES, PER_CHAT_CAP_BYTES, saveChat, type StoredChat, trimToCap } from './chat-history';

const turn = (role: 'user' | 'assistant', text: string, extra: Partial<StoredChat['turns'][number]> = {}) => ({ role, displayText: text, timestamp: 1, ...extra });

describe('chat history', () => {
  it('keys by org and FlowDefinition id, so a flowId URL and a flowDefId URL share one chat', () => {
    expect(chatKey('00DXXXXXXXXXXXX', '300XXXX0000ABCDxyz')).toBe('chat:00DXXXXXXXXXXXX:300XXXX0000ABCDxyz');
    expect(chatKey(null, '300XXXX0000ABCDxyz')).toBe('chat:unknown:300XXXX0000ABCDxyz');
  });

  it('round-trips a chat in chrome.storage.local and clears it', async () => {
    const chat: StoredChat = { key: chatKey('org', 'def'), turns: [turn('user', 'Hi', { sentText: '<user_question>Hi</user_question>', mode: 'ask' }), turn('assistant', 'Hello', { stopReason: 'end' })], updatedAt: 0 };
    await saveChat(chat);
    const stored = await getChat(chat.key);
    expect(stored?.turns).toEqual(chat.turns);
    expect(stored?.updatedAt).toBeGreaterThan(0);
    await clearChat(chat.key);
    expect(await getChat(chat.key)).toBeNull();
  });

  it('per-chat cap: drops the oldest turns in pairs until it fits, keeping at least the last pair', () => {
    const big = 'x'.repeat(90 * 1024);
    const chat: StoredChat = { key: 'chat:a:b', turns: [turn('user', 'q1'), turn('assistant', big), turn('user', 'q2'), turn('assistant', big), turn('user', 'q3'), turn('assistant', big)], updatedAt: 1 };
    const trimmed = trimToCap(chat, PER_CHAT_CAP_BYTES);
    expect(trimmed.turns.map((t) => t.displayText.slice(0, 2))).toEqual(['q2', 'xx', 'q3', 'xx']);
    const tiny = trimToCap({ ...chat, turns: chat.turns.slice(0, 2) }, 10);
    expect(tiny.turns).toHaveLength(2);
  });

  it('global cap: evicts the least recently updated other chats', async () => {
    const big = 'x'.repeat(150 * 1024);
    for (let i = 0; i < 40; i++) {
      await fakeBrowser.storage.local.set({ [`chat:o:${i}`]: { key: `chat:o:${i}`, turns: [turn('user', 'q'), turn('assistant', big)], updatedAt: i } });
    }
    await saveChat({ key: 'chat:o:new', turns: [turn('user', 'q'), turn('assistant', big)], updatedAt: 0 });
    const all = await fakeBrowser.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith('chat:'));
    const total = new TextEncoder().encode(JSON.stringify(all)).length;
    expect(total).toBeLessThanOrEqual(GLOBAL_CAP_BYTES + 200 * 1024);
    expect(keys).toContain('chat:o:new');
    expect(keys).not.toContain('chat:o:0');
    expect(keys).toContain('chat:o:39');
  });

  it('a storage failure is swallowed', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValueOnce(new Error('QUOTA_BYTES exceeded'));
    await expect(saveChat({ key: 'chat:a:b', turns: [turn('user', 'q')], updatedAt: 0 })).resolves.toBeUndefined();
  });

  describe('throttled writer', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('coalesces many writes into one save per interval and flushNow writes the latest', async () => {
      const setSpy = vi.spyOn(fakeBrowser.storage.local, 'set');
      const writer = createChatWriter(400);
      for (let i = 0; i < 5; i++) writer.write({ key: 'chat:a:b', turns: [turn('assistant', `partial ${i}`, { interrupted: 'error' })], updatedAt: 0 });
      expect(setSpy).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(400);
      expect(setSpy).toHaveBeenCalledTimes(1);
      expect((await getChat('chat:a:b'))?.turns[0]?.displayText).toBe('partial 4');
      await writer.flushNow({ key: 'chat:a:b', turns: [turn('assistant', 'final', { stopReason: 'end' })], updatedAt: 0 });
      expect((await getChat('chat:a:b'))?.turns[0]?.displayText).toBe('final');
    });

    it('cancel drops a pending write, so a cleared chat stays cleared', async () => {
      const writer = createChatWriter(400);
      writer.write({ key: 'chat:a:b', turns: [turn('assistant', 'partial', { interrupted: 'error' })], updatedAt: 0 });
      writer.cancel();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await getChat('chat:a:b')).toBeNull();
      // Still usable afterwards.
      await writer.flushNow({ key: 'chat:a:b', turns: [turn('user', 'q')], updatedAt: 0 });
      expect((await getChat('chat:a:b'))?.turns).toHaveLength(1);
    });
  });
});
