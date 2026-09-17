import { useEffect, useState } from 'react';

import type { ActiveFlowState } from '@/hooks/useActiveFlow';
import { clearExcalidrawPending, excalidrawPending } from '@/lib/excalidraw-export';
import { providerName } from '@/lib/models';
import type { Readiness, Settings } from '@/lib/settings';

import { ChatView } from './ChatView';
import { Header, type HeaderFlow } from './Header';
import { PanelState } from './PanelState';
import { describeState, setUpAiState } from './panel-states';
import { SettingsView } from './SettingsView';
import { Skeleton } from './Skeleton';

export type ShellView = 'panel' | 'settings';

export interface ShellProps {
  state: ActiveFlowState;
  refreshing: boolean;
  onRefresh: () => void;
  /** "Set up your AI" wins over every tab state until this is ready. */
  readiness: Readiness;
  settings: Settings;
  onUpdateSettings: (apply: (s: Settings) => Settings) => Promise<unknown>;
  /** Injected by the gallery to freeze "Saved … ago". */
  now?: number;
  initialView?: ShellView;
  /** Demo mode: Settings hides "Try the demo" because this already is the demo. */
  demo?: boolean;
}

function headerFlow(state: ActiveFlowState): HeaderFlow | null {
  if (state.kind !== 'flow') return null;
  const { record, definition } = state.flow.loaded;
  return {
    label: record.MasterLabel,
    version: record.VersionNumber,
    status: record.Status,
    latestNumber: definition.LatestVersionNumber,
    activeNumber: definition.ActiveVersionNumber,
    lastModified: record.LastModifiedDate,
  };
}

// The panel's frame: header on top, the body owns the space. Settings is an
// in-panel view; every state keeps the header's Settings entry reachable.
export function Shell({ state, refreshing, onRefresh, readiness, settings, onUpdateSettings, now, initialView = 'panel', demo = false }: ShellProps) {
  const [view, setView] = useState<ShellView>(initialView);
  // First run is decided when Settings opens and held until it closes: the
  // moment a key is accepted, readiness flips, and the view must keep its
  // first-run shape so "Start chatting" can appear.
  const [firstRun, setFirstRun] = useState(initialView === 'settings' && !readiness.ready);
  const openSettings = () => {
    setFirstRun(!readiness.ready);
    setView('settings');
  };
  // Back on a flow after Open in Excalidraw: the paste note on "Not on Salesforce" has done its job.
  useEffect(() => {
    if (state.kind === 'flow') clearExcalidrawPending();
  }, [state.kind]);

  if (view === 'settings') {
    return <SettingsView onBack={() => setView('panel')} firstRun={firstRun} onStartChatting={() => setView('panel')} demo={demo} />;
  }

  if (!readiness.ready) {
    return (
      <div className="flex h-full flex-col">
        <Header flow={null} onOpenSettings={openSettings} now={now} />
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <PanelState
            {...setUpAiState(readiness.forgotten ? 'forgotten' : readiness.unchecked ? 'unchecked' : 'first', openSettings, settings.activeProvider ? providerName(settings.activeProvider) : undefined)}
          />
        </main>
      </div>
    );
  }

  if (state.kind === 'loading') {
    return <Skeleton />;
  }

  const flow = headerFlow(state);
  if (state.kind === 'flow' && flow) {
    return <ChatView flow={state.flow} header={flow} refreshing={refreshing} onRefresh={onRefresh} settings={settings} onUpdateSettings={onUpdateSettings} onOpenSettings={openSettings} now={now} />;
  }
  const empty = describeState(state, { refresh: onRefresh, excalidrawPending: excalidrawPending() });

  return (
    <div className="flex h-full flex-col">
      <Header flow={flow} refreshing={refreshing} onRefresh={onRefresh} onOpenSettings={openSettings} now={now} />
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{empty && <PanelState {...empty} />}</main>
    </div>
  );
}
