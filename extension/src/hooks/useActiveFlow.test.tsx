import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import syntheticFlow from '../../test/fixtures/synthetic-flow.json';
import { useActiveFlow } from './useActiveFlow';

const VERSION_ID = '301XXXX0000ABCDxyz';
const DEFINITION_ID = '300XXXX0000ABCDxyz';
const SECOND_VERSION_ID = '301XXXX0000SECONDx';
const SECOND_DEFINITION_ID = '300XXXX0000SECONDx';
const ORG_ID = '00DXXXXXXXXXXXX';

const BUILDER = 'https://mycompany.lightning.force.com/builder_platform_interaction/flowBuilder.app';
const FLOW_A = `${BUILDER}?flowId=${VERSION_ID}&clc=1`;
const FLOW_B = `${BUILDER}?flowId=${SECOND_VERSION_ID}&clc=2`;
const FLOWS_LIST = 'https://mycompany.lightning.force.com/lightning/setup/Flows/home';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function flowRecord(versionId: string) {
  const definitionId = versionId === SECOND_VERSION_ID ? SECOND_DEFINITION_ID : DEFINITION_ID;
  return {
    Id: versionId,
    VersionNumber: 4,
    Status: 'Draft',
    MasterLabel: versionId === SECOND_VERSION_ID ? 'Second Flow' : 'Synthetic Test Flow',
    DefinitionId: definitionId,
    ProcessType: 'AutoLaunchedFlow',
    LastModifiedDate: '2026-09-01T10:00:00.000+0000',
    Metadata: syntheticFlow,
  };
}

function definitionRow(path: string) {
  const id = /Id%20%3D%20'([A-Za-z0-9]+)'/.exec(path)?.[1] ?? DEFINITION_ID;
  return {
    records: [
      { Id: id, ActiveVersionId: null, ActiveVersion: null, LatestVersionId: VERSION_ID, LatestVersion: { VersionNumber: 4 } },
    ],
  };
}

/** A Tooling API stand-in keyed by URL; `hang` makes a given flow's fetch wait until released. */
function mockTooling(opts: { hang?: string; status?: number } = {}) {
  const released = new Map<string, () => void>();
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (opts.status && opts.status !== 200) {
      return json([{ errorCode: 'INVALID_SESSION_ID', message: 'Session expired or invalid' }], opts.status);
    }
    const versionId = /\/tooling\/sobjects\/Flow\/([A-Za-z0-9]+)$/.exec(url)?.[1];
    if (versionId) {
      if (opts.hang === versionId) {
        await new Promise<void>((resolve, reject) => {
          released.set(versionId, resolve);
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        });
      }
      return json(flowRecord(versionId));
    }
    if (url.includes('/tooling/query/')) return json(definitionRow(url));
    throw new Error(`unexpected fetch ${url}`);
  });
  return { fetchSpy, release: (id: string) => released.get(id)?.() };
}

function mockCookie(value: string | null) {
  fakeBrowser.cookies.get = vi.fn(async () =>
    value === null ? null : { name: 'sid', value },
  ) as unknown as typeof fakeBrowser.cookies.get;
}

/** Two windows; the panel lives in `mine`. The fake models one global active tab, so create `mine`'s tab last. */
async function arrange(urls: { mine: string | undefined; other?: string }) {
  const other = (await fakeBrowser.windows.create({}))!;
  const mine = (await fakeBrowser.windows.create({ focused: true }))!;
  const otherTab = await fakeBrowser.tabs.create({ windowId: other.id, url: urls.other ?? 'https://example.com/' });
  const myTab = await fakeBrowser.tabs.create({ windowId: mine.id, url: urls.mine, active: true });
  return { mineId: mine.id as number, otherId: other.id as number, myTabId: myTab.id as number, otherTab };
}

beforeEach(() => {
  mockCookie(`${ORG_ID}!opaqueSessionToken`);
});

describe('useActiveFlow — first load', () => {
  it('loads the flow behind the active tab of its own window', async () => {
    await arrange({ mine: FLOW_A });
    const { fetchSpy } = mockTooling();
    const { result } = renderHook(() => useActiveFlow());

    expect(result.current.state.kind).toBe('loading');
    await waitFor(() => expect(result.current.state.kind).toBe('flow'));
    const state = result.current.state;
    if (state.kind !== 'flow') throw new Error('unreachable');
    expect(state.flow.key).toBe(`chat:${ORG_ID}:${DEFINITION_ID}`);
    expect(state.flow.sfHost).toBe('mycompany.my.salesforce.com');
    expect(state.flow.loaded.record.MasterLabel).toBe('Synthetic Test Flow');
    expect(JSON.stringify(state.flow.metadata)).not.toContain('locationX');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const [url] of fetchSpy.mock.calls) {
      expect(String(url)).toMatch(/^https:\/\/mycompany\.my\.salesforce\.com\//);
    }
  });

  it('maps a Setup-domain tab to the My-Domain host for the cookie and the API', async () => {
    await arrange({ mine: `https://mycompany.my.salesforce-setup.com/builder_platform_interaction/flowBuilder.app?flowId=${VERSION_ID}` });
    const { fetchSpy } = mockTooling();
    const { result } = renderHook(() => useActiveFlow());
    await waitFor(() => expect(result.current.state.kind).toBe('flow'));
    expect(fakeBrowser.cookies.get).toHaveBeenCalledWith({ url: 'https://mycompany.my.salesforce.com', name: 'sid' });
    expect(String(fetchSpy.mock.calls[0]![0])).toMatch(/^https:\/\/mycompany\.my\.salesforce\.com\//);
  });

  it.each([
    ['a non-Salesforce tab', 'https://example.com/', 'notOnSalesforce'],
    ['a tab whose url is hidden (no host permission)', undefined, 'notOnSalesforce'],
    ['the Flows list page', FLOWS_LIST, 'notOnFlowPage'],
    ['a new unsaved flow in Builder', BUILDER, 'unsavedFlow'],
  ])('%s -> %s without calling Salesforce', async (_label, url, expected) => {
    await arrange({ mine: url });
    const { fetchSpy } = mockTooling();
    const { result } = renderHook(() => useActiveFlow());
    await waitFor(() => expect(result.current.state.kind).toBe(expected));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports noSession when there is no sid cookie, and sessionExpired on a 401', async () => {
    await arrange({ mine: FLOW_A });
    mockCookie(null);
    mockTooling();
    const first = renderHook(() => useActiveFlow());
    await waitFor(() => expect(first.result.current.state).toEqual({ kind: 'noSession', sfHost: 'mycompany.my.salesforce.com' }));
    first.unmount();

    mockCookie(`${ORG_ID}!stale`);
    mockTooling({ status: 401 });
    const second = renderHook(() => useActiveFlow());
    await waitFor(() =>
      expect(second.result.current.state).toEqual({ kind: 'error', errorKind: 'sessionExpired', sfHost: 'mycompany.my.salesforce.com' }),
    );
  });
});

describe('useActiveFlow — acceptance: tab switching', () => {
  it('switch tab: leaving the flow for the Flows list changes the state, coming back reloads the same flow', async () => {
    const { mineId, myTabId } = await arrange({ mine: FLOW_A });
    const { fetchSpy } = mockTooling();
    const { result } = renderHook(() => useActiveFlow());
    await waitFor(() => expect(result.current.state.kind).toBe('flow'));

    const listTab = await fakeBrowser.tabs.create({ windowId: mineId, url: FLOWS_LIST, active: true });
    await waitFor(() => expect(result.current.state.kind).toBe('notOnFlowPage'));
    expect(listTab.active).toBe(true);

    await act(async () => {
      await fakeBrowser.tabs.update(myTabId, { active: true });
    });
    await waitFor(() => expect(result.current.state.kind).toBe('flow'));
    const state = result.current.state;
    if (state.kind !== 'flow') throw new Error('unreachable');
    expect(state.flow.key).toBe(`chat:${ORG_ID}:${DEFINITION_ID}`);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it('open a second flow: a URL change in the active tab loads the new flow and its own history key', async () => {
    const { myTabId } = await arrange({ mine: FLOW_A });
    const { fetchSpy } = mockTooling();
    const { result } = renderHook(() => useActiveFlow());
    await waitFor(() => expect(result.current.state.kind).toBe('flow'));

    await act(async () => {
      await fakeBrowser.tabs.update(myTabId, { url: FLOW_B });
    });
    await waitFor(() => {
      const s = result.current.state;
      expect(s.kind === 'flow' && s.flow.key).toBe(`chat:${ORG_ID}:${SECOND_DEFINITION_ID}`);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it('return to the first flow without losing the chat: re-activating the already loaded tab is a no-op', async () => {
    const { mineId, myTabId } = await arrange({ mine: FLOW_A });
    const { fetchSpy } = mockTooling();
    const { result } = renderHook(() => useActiveFlow());
    await waitFor(() => expect(result.current.state.kind).toBe('flow'));
    const loaded = result.current.state;

    // Chrome fires onActivated (and sometimes onUpdated) again for the same tab.
    await act(async () => {
      await fakeBrowser.tabs.onActivated.trigger({ tabId: myTabId, windowId: mineId });
      await fakeBrowser.tabs.onUpdated.trigger(myTabId, { url: `${BUILDER}?clc=9&flowId=${VERSION_ID}` }, {
        ...(await fakeBrowser.tabs.get(myTabId)),
        active: true,
      });
    });

    expect(result.current.state).toBe(loaded);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('a tab change in another Chrome window does nothing', async () => {
    const { mineId, otherId, otherTab } = await arrange({ mine: FLOW_A, other: FLOW_B });
    const { fetchSpy } = mockTooling();
    const querySpy = vi.spyOn(fakeBrowser.tabs, 'query');
    const { result } = renderHook(() => useActiveFlow());
    await waitFor(() => expect(result.current.state.kind).toBe('flow'));
    const loaded = result.current.state;
    const queriesSoFar = querySpy.mock.calls.length;

    await act(async () => {
      await fakeBrowser.tabs.onActivated.trigger({ tabId: otherTab.id!, windowId: otherId });
      await fakeBrowser.tabs.onUpdated.trigger(otherTab.id!, { url: FLOW_A }, { ...otherTab, active: true, url: FLOW_A });
    });

    expect(result.current.state).toBe(loaded);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // The events were ignored before any tab lookup, and every lookup is scoped to this window.
    expect(querySpy.mock.calls.length).toBe(queriesSoFar);
    for (const [query] of querySpy.mock.calls) expect(query).toEqual({ active: true, windowId: mineId });
  });

  it('the active tab leaving Salesforce in place (status-only update, url hidden) empties the panel', async () => {
    const { myTabId } = await arrange({ mine: FLOW_A });
    const { fetchSpy } = mockTooling();
    const { result } = renderHook(() => useActiveFlow());
    await waitFor(() => expect(result.current.state.kind).toBe('flow'));
    const loaded = result.current.state;

    // Same flow, a status-only event: no change, no fetch.
    const tab = await fakeBrowser.tabs.get(myTabId);
    await act(async () => {
      await fakeBrowser.tabs.onUpdated.trigger(myTabId, { status: 'complete' }, { ...tab, active: true });
    });
    expect(result.current.state).toBe(loaded);

    // Chrome strips url from both the event and the tab for a host we cannot see.
    vi.spyOn(fakeBrowser.tabs, 'query').mockImplementation((async () => [{ ...tab, url: undefined, active: true }]) as never);
    await act(async () => {
      await fakeBrowser.tabs.onUpdated.trigger(myTabId, { status: 'complete' }, { ...tab, url: undefined, active: true });
    });
    await waitFor(() => expect(result.current.state.kind).toBe('notOnSalesforce'));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('useActiveFlow — in-flight guard and refresh', () => {
  it('aborts a stale extraction when the tab moves on, and its late rejection changes nothing', async () => {
    const { myTabId } = await arrange({ mine: FLOW_A });
    const { fetchSpy, release } = mockTooling({ hang: VERSION_ID });
    const { result } = renderHook(() => useActiveFlow());
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const firstSignal = fetchSpy.mock.calls[0]![1]?.signal;

    await act(async () => {
      await fakeBrowser.tabs.update(myTabId, { url: FLOW_B });
    });
    await waitFor(() => {
      const s = result.current.state;
      expect(s.kind === 'flow' && s.flow.key).toBe(`chat:${ORG_ID}:${SECOND_DEFINITION_ID}`);
    });
    expect(firstSignal?.aborted).toBe(true);

    const settled = result.current.state;
    release(VERSION_ID);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.state).toBe(settled);
  });

  it('refresh() re-reads the same flow while keeping it on screen', async () => {
    await arrange({ mine: FLOW_A });
    const { fetchSpy, release } = mockTooling({ hang: VERSION_ID });
    const { result } = renderHook(() => useActiveFlow());
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    release(VERSION_ID);
    await waitFor(() => expect(result.current.state.kind).toBe('flow'));
    const before = result.current.state;

    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.refreshing).toBe(true));
    expect(result.current.state).toBe(before);
    expect(result.current.state.kind).toBe('flow');

    release(VERSION_ID);
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.state.kind).toBe('flow');
    expect(result.current.state).not.toBe(before);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it('a duplicate event during a load neither restarts nor duplicates it (in-flight guard)', async () => {
    const { mineId, myTabId } = await arrange({ mine: FLOW_A });
    const { fetchSpy, release } = mockTooling({ hang: VERSION_ID });
    const { result } = renderHook(() => useActiveFlow());
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const firstSignal = fetchSpy.mock.calls[0]![1]?.signal;

    await act(async () => {
      await fakeBrowser.tabs.onActivated.trigger({ tabId: myTabId, windowId: mineId });
      await fakeBrowser.tabs.onUpdated.trigger(myTabId, { status: 'complete' }, { ...(await fakeBrowser.tabs.get(myTabId)), active: true });
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(firstSignal?.aborted).toBe(false);

    release(VERSION_ID);
    await waitFor(() => expect(result.current.state.kind).toBe('flow'));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('leaving Salesforce cancels the load, and its late success cannot overwrite the empty state', async () => {
    const { myTabId } = await arrange({ mine: FLOW_A });
    const { fetchSpy, release } = mockTooling({ hang: VERSION_ID });
    const { result } = renderHook(() => useActiveFlow());
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    await act(async () => {
      await fakeBrowser.tabs.update(myTabId, { url: 'https://example.com/' });
    });
    await waitFor(() => expect(result.current.state.kind).toBe('notOnSalesforce'));
    expect(fetchSpy.mock.calls[0]![1]?.signal?.aborted).toBe(true);

    release(VERSION_ID);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.state.kind).toBe('notOnSalesforce');
  });

  it('a navigation that supersedes an in-flight refresh clears the refreshing flag', async () => {
    const { myTabId } = await arrange({ mine: FLOW_A });
    const { fetchSpy, release } = mockTooling({ hang: VERSION_ID });
    const { result } = renderHook(() => useActiveFlow());
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    release(VERSION_ID);
    await waitFor(() => expect(result.current.state.kind).toBe('flow'));

    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.refreshing).toBe(true));
    await act(async () => {
      await fakeBrowser.tabs.update(myTabId, { url: FLOWS_LIST });
    });
    await waitFor(() => expect(result.current.state.kind).toBe('notOnFlowPage'));
    expect(result.current.refreshing).toBe(false);
  });

  it('refresh() after a session error retries from scratch ("Check again")', async () => {
    await arrange({ mine: FLOW_A });
    mockCookie(null);
    mockTooling();
    const { result } = renderHook(() => useActiveFlow());
    await waitFor(() => expect(result.current.state.kind).toBe('noSession'));

    mockCookie(`${ORG_ID}!fresh`);
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.state.kind).toBe('flow'));
  });

  it('removes its listeners on unmount', async () => {
    await arrange({ mine: FLOW_A });
    mockTooling();
    const { result, unmount } = renderHook(() => useActiveFlow());
    await waitFor(() => expect(result.current.state.kind).toBe('flow'));
    expect(fakeBrowser.tabs.onActivated.hasListeners()).toBe(true);
    unmount();
    expect(fakeBrowser.tabs.onActivated.hasListeners()).toBe(false);
    expect(fakeBrowser.tabs.onUpdated.hasListeners()).toBe(false);
  });
});
