import { describe, expect, it, vi } from 'vitest';

import { describeState, DISCLOSURE_GENERIC, setUpAiState } from './panel-states';

const SF = 'mycompany.my.salesforce.com';

describe('describeState', () => {
  it('returns null while loading and when a flow is shown', () => {
    expect(describeState({ kind: 'loading' }, { refresh: vi.fn() })).toBeNull();
  });

  it.each([
    [{ kind: 'notOnSalesforce' } as const, 'Open a Salesforce org to get started, then open any Flow.'],
    [{ kind: 'notOnFlowPage', sfHost: SF } as const, 'Go to Setup → Flows and open one. This panel follows the tab.'],
    [{ kind: 'unsavedFlow', sfHost: SF } as const, 'Flow Companion reads the last saved version. Save, then this panel will pick it up.'],
    [
      { kind: 'error', errorKind: 'apiDisabled', sfHost: SF } as const,
      'Your org or profile blocks API access, which this extension needs. Check Setup → Profiles → your profile → API Enabled, and Setup → API Access Control.',
    ],
  ])('%o uses the design’s sentence', (state, body) => {
    expect(describeState(state, { refresh: vi.fn() })?.body).toBe(body);
  });

  it('right after Open in Excalidraw, "Not on Salesforce" carries the paste instruction as its note', () => {
    expect(describeState({ kind: 'notOnSalesforce' }, { refresh: vi.fn() })?.note).toBeUndefined();
    expect(describeState({ kind: 'notOnSalesforce' }, { refresh: vi.fn(), excalidrawPending: 'elements' })?.note).toMatch(
      /^Your diagram is on the clipboard\. Press (⌘V|Ctrl\+V) on the Excalidraw canvas, then come back to your Flow tab to keep chatting\.$/,
    );
    expect(describeState({ kind: 'notOnSalesforce' }, { refresh: vi.fn(), excalidrawPending: 'text' })?.note).toMatch(/More tools → Mermaid to Excalidraw/);
    expect(describeState({ kind: 'notOnFlowPage', sfHost: SF }, { refresh: vi.fn(), excalidrawPending: 'elements' })?.note).toBeUndefined();
  });

  it('session states carry a Check again action that re-derives', () => {
    const refresh = vi.fn();
    for (const state of [
      { kind: 'noSession', sfHost: SF } as const,
      { kind: 'error', errorKind: 'sessionExpired', sfHost: SF } as const,
    ]) {
      const props = describeState(state, { refresh });
      expect(props?.action?.label).toBe('Check again');
      props?.action?.onClick();
    }
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('retryable failures offer Try again; blocked orgs and proxies offer nothing to retry', () => {
    const refresh = vi.fn();
    expect(describeState({ kind: 'error', errorKind: 'network', sfHost: SF }, { refresh })?.action?.label).toBe('Try again');
    expect(describeState({ kind: 'error', errorKind: 'unknown', sfHost: SF }, { refresh })?.action?.label).toBe('Try again');
    expect(describeState({ kind: 'error', errorKind: 'proxyBlocked', sfHost: SF }, { refresh })?.action).toBeUndefined();
    expect(describeState({ kind: 'error', errorKind: 'apiDisabled', sfHost: SF }, { refresh })?.action).toBeUndefined();
  });

  it('never leaks technical words into the copy', () => {
    const states = [
      { kind: 'notOnSalesforce' } as const,
      { kind: 'noSession', sfHost: SF } as const,
      ...(['sessionExpired', 'orgApiLimitReached', 'apiDisabled', 'insufficientAccess', 'forbidden', 'proxyBlocked', 'network', 'unknown'] as const).map(
        (errorKind) => ({ kind: 'error', errorKind, sfHost: SF }) as const,
      ),
    ];
    for (const state of states) {
      const props = describeState(state, { refresh: vi.fn() });
      const text = `${props?.title} ${props?.body}`;
      expect(text).not.toMatch(/\b(cookie|sid|token|chrome\.storage|HTTP|403|401|JSON)\b/i);
    }
  });
});

describe('setUpAiState', () => {
  it('carries the generic disclosure and the Set up your AI action', () => {
    const onSetUp = vi.fn();
    const first = setUpAiState('first', onSetUp);
    expect(first.title).toBe('Set up your AI');
    expect(first.body).toBe('Flow Companion uses an AI account you own. Paste a key from Anthropic, OpenAI, or Google.');
    expect(first.note).toBe(DISCLOSURE_GENERIC);
    first.action?.onClick();
    expect(onSetUp).toHaveBeenCalled();
    expect(setUpAiState('forgotten', onSetUp).body).toBe('Your key was forgotten when Chrome closed, as you chose. Paste it again to continue.');
    const unchecked = setUpAiState('unchecked', onSetUp, 'Anthropic');
    expect(unchecked.title).toBe('Check your key');
    expect(unchecked.body).toBe('Your key is saved, but Anthropic couldn’t be reached to check it. Open Settings and check again.');
    expect(unchecked.action?.label).toBe('Open Settings');
  });
});
