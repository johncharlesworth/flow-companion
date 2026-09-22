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

  it('"Not on Salesforce" offers the demo flow, with a note that claims nothing about the key; "Open a Flow" offers nothing', () => {
    expect(describeState({ kind: 'notOnSalesforce' }, { refresh: vi.fn() })?.link).toEqual({
      label: 'Try a demo flow',
      href: '/sidepanel.html?demo=1',
      note: 'Opens in a new tab.',
    });
    expect(describeState({ kind: 'notOnFlowPage', sfHost: SF }, { refresh: vi.fn() })?.link).toBeUndefined();
    expect(describeState({ kind: 'unsavedFlow', sfHost: SF }, { refresh: vi.fn() })?.link).toBeUndefined();
  });

  it('while the Excalidraw paste note is showing, "Not on Salesforce" keeps to that one instruction: no demo-flow link', () => {
    expect(describeState({ kind: 'notOnSalesforce' }, { refresh: vi.fn(), excalidrawPending: 'elements' })?.link).toBeUndefined();
    expect(describeState({ kind: 'notOnSalesforce' }, { refresh: vi.fn(), excalidrawPending: 'text' })?.link).toBeUndefined();
    expect(describeState({ kind: 'notOnSalesforce' }, { refresh: vi.fn(), excalidrawPending: null })?.link?.label).toBe('Try a demo flow');
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

  it('shows the Excalidraw paste note on the gate while an export is pending', () => {
    expect(setUpAiState('first', vi.fn(), undefined, 'elements').note).toMatch(/on the clipboard/);
    expect(setUpAiState('first', vi.fn(), undefined, 'text').note).toMatch(/More tools → Mermaid to Excalidraw/);
    expect(setUpAiState('first', vi.fn(), undefined, null).note).toBeUndefined();
    expect(setUpAiState('forgotten', vi.fn(), undefined, null).note).toBe(DISCLOSURE_GENERIC);
    expect(setUpAiState('first', vi.fn(), undefined, 'elements').link?.label).toBe('See it on a demo flow first');
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
    expect(first.body).toBe('Flow Companion uses an API key from an AI account you own. When you chat, your flow’s saved metadata is sent to the AI provider you choose, under your key. Nothing else leaves your browser.');
    expect(first.note).toBeUndefined();
    expect(DISCLOSURE_GENERIC).toBe('When you chat, this flow’s saved metadata is sent to the AI provider you choose, under your key. Nothing else leaves your browser.');
    first.action?.onClick();
    expect(onSetUp).toHaveBeenCalled();
    expect(setUpAiState('forgotten', onSetUp).body).toBe('Your key was forgotten when Chrome closed, as you chose. Paste it again to continue.');
    const unchecked = setUpAiState('unchecked', onSetUp, 'Anthropic');
    expect(unchecked.title).toBe('Check your key');
    expect(unchecked.body).toBe('Your key is saved, but Anthropic couldn’t be reached to check it. Open Settings and check again.');
    expect(unchecked.action?.label).toBe('Open Settings');
  });

  it('only the first-run gate offers the demo flow; a forgotten or unchecked key has one thing to do', () => {
    expect(setUpAiState('first', vi.fn()).link).toEqual({
      label: 'See it on a demo flow first',
      href: '/sidepanel.html?demo=1',
      note: 'No key needed. Opens in a new tab.',
    });
    expect(setUpAiState('forgotten', vi.fn()).link).toBeUndefined();
    expect(setUpAiState('unchecked', vi.fn(), 'Anthropic').link).toBeUndefined();
  });
});
