// Follows the active tab of the panel's own window and keeps the flow it
// shows loaded. This replaces the earlier build message bus: the panel reads tabs
// and cookies itself (no content script, no background round-trip).
//
// Lessons from the v1 tab-switching bug, all encoded here:
// - resolve the panel's windowId once and ignore events from other windows;
// - listen to onActivated and onUpdated (url changes and status changes: without
//   the tabs permission Chrome strips the url from updates for hosts the
//   extension cannot see, so status is the only signal that the tab left Salesforce);
// - compare parsed ids, never raw URLs;
// - guard in-flight loads and abort stale extractions on navigation;
// - re-deriving the same, already loaded flow is a no-op, so the chat never remounts.

import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';

import {
  extractFlow,
  type FlowRoute,
  type LoadedFlow,
  NotOnFlowPageError,
  parseFlowRoute,
  sameFlowRoute,
  UnsavedFlowError,
} from '@/lib/flow-extractor';
import { chatKey } from '@/lib/chat-history';
import { normalizeFlow } from '@/lib/flow-normalizer';
import { classify, isAbortError, type SfErrorKind } from '@/lib/sf-error-kind';
import { toToolingHost } from '@/lib/sf-host';
import { readSession } from '@/lib/sf-session';
import { SfdcClient } from '@/lib/sfdc-client';

export interface ActiveFlow {
  /** History key: the fetched record's FlowDefinition id, never the URL's version id. */
  key: string;
  sfHost: string;
  orgId: string | null;
  route: FlowRoute;
  loaded: LoadedFlow;
  /** The record's Metadata with canvas noise stripped; what the model receives. */
  metadata: unknown;
}

export type ActiveFlowState =
  | { kind: 'loading' }
  | { kind: 'notOnSalesforce' }
  | { kind: 'notOnFlowPage'; sfHost: string }
  | { kind: 'unsavedFlow'; sfHost: string }
  | { kind: 'noSession'; sfHost: string }
  | { kind: 'error'; errorKind: SfErrorKind; sfHost: string }
  | { kind: 'flow'; flow: ActiveFlow };

export interface UseActiveFlowResult {
  state: ActiveFlowState;
  /** True while a forced re-read of the current flow is in flight (the flow stays on screen). */
  refreshing: boolean;
  /** Re-read the active tab's flow even if it is already loaded (Refresh, Check again). */
  refresh: () => void;
}

interface Target {
  sfHost: string;
  route: FlowRoute;
}

function sameTarget(a: Target | null, b: Target): boolean {
  return a !== null && a.sfHost === b.sfHost && sameFlowRoute(a.route, b.route);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function useActiveFlow(): UseActiveFlowResult {
  const [state, setState] = useState<ActiveFlowState>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const windowIdRef = useRef<number | null>(null);
  /** What the panel is showing or loading, compared by parsed ids. */
  const targetRef = useRef<Target | null>(null);
  /** Set synchronously when a flow is shown for targetRef, so a derive that lands before React commits still sees it. */
  const loadedTargetRef = useRef<Target | null>(null);
  const inFlightRef = useRef<AbortController | null>(null);

  const cancelInFlight = useCallback(() => {
    inFlightRef.current?.abort(new DOMException('Superseded by navigation', 'AbortError'));
    inFlightRef.current = null;
    setRefreshing(false);
  }, []);

  const show = useCallback((next: ActiveFlowState, target: Target | null) => {
    loadedTargetRef.current = next.kind === 'flow' ? target : null;
    setState(next);
  }, []);

  const derive = useCallback(
    async (force: boolean) => {
      const windowId = windowIdRef.current;
      if (windowId === null) return;

      const [tab] = await browser.tabs.query({ active: true, windowId });
      // Without the `tabs` permission, url is only populated for hosts the
      // extension has host permissions for; anything else is "not Salesforce".
      const tabHost = tab?.url ? hostOf(tab.url) : null;
      const sfHost = tabHost ? toToolingHost(tabHost) : null;
      if (!sfHost || !tab?.url) {
        cancelInFlight();
        targetRef.current = null;
        show({ kind: 'notOnSalesforce' }, null);
        return;
      }

      const target: Target = { sfHost, route: parseFlowRoute(tab.url) };
      const unchanged = sameTarget(targetRef.current, target);
      const settled = loadedTargetRef.current !== null || inFlightRef.current !== null;
      if (!force && settled && unchanged) return;

      const keepCurrentFlow = force && unchanged && loadedTargetRef.current !== null;
      cancelInFlight();
      targetRef.current = target;

      if (target.route.kind === 'notOnFlowPage') {
        show({ kind: 'notOnFlowPage', sfHost }, target);
        return;
      }
      if (target.route.kind === 'unsavedFlow') {
        show({ kind: 'unsavedFlow', sfHost }, target);
        return;
      }

      const controller = new AbortController();
      inFlightRef.current = controller;
      if (keepCurrentFlow) setRefreshing(true);
      else show({ kind: 'loading' }, target);

      try {
        const session = await readSession(sfHost);
        if (controller.signal.aborted) return;
        if (!session) {
          show({ kind: 'noSession', sfHost }, target);
          return;
        }
        const client = new SfdcClient({ sfHost, sid: session.sid });
        const loaded = await extractFlow(client, target.route, controller.signal);
        if (controller.signal.aborted) return;
        show(
          {
            kind: 'flow',
            flow: {
              key: chatKey(session.orgId, loaded.record.DefinitionId),
              sfHost,
              orgId: session.orgId,
              route: target.route,
              loaded,
              metadata: normalizeFlow(loaded.record.Metadata),
            },
          },
          target,
        );
      } catch (err) {
        if (controller.signal.aborted || isAbortError(err)) return;
        if (err instanceof UnsavedFlowError) show({ kind: 'unsavedFlow', sfHost }, target);
        else if (err instanceof NotOnFlowPageError) show({ kind: 'notOnFlowPage', sfHost }, target);
        else show({ kind: 'error', errorKind: classify(err), sfHost }, target);
      } finally {
        if (inFlightRef.current === controller) {
          inFlightRef.current = null;
          setRefreshing(false);
        }
      }
    },
    [cancelInFlight, show],
  );

  useEffect(() => {
    let disposed = false;

    const onActivated = (info: { tabId: number; windowId: number }) => {
      if (info.windowId !== windowIdRef.current) return;
      void derive(false);
    };
    const onUpdated = (
      _tabId: number,
      changeInfo: { url?: string; status?: string },
      tab: { windowId?: number; active?: boolean },
    ) => {
      if (tab.windowId !== windowIdRef.current || !tab.active) return;
      if (changeInfo.url === undefined && changeInfo.status === undefined) return;
      void derive(false);
    };

    void browser.windows.getCurrent().then((win) => {
      if (disposed || win?.id === undefined) return;
      windowIdRef.current = win.id;
      browser.tabs.onActivated.addListener(onActivated);
      browser.tabs.onUpdated.addListener(onUpdated);
      void derive(false);
    });

    return () => {
      disposed = true;
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
      cancelInFlight();
    };
  }, [derive, cancelInFlight]);

  const refresh = useCallback(() => {
    void derive(true);
  }, [derive]);

  return { state, refreshing, refresh };
}
