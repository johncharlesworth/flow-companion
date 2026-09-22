import { useEffect, useState } from 'react';

import { Shell } from '@/components/Shell';
import { Skeleton } from '@/components/Skeleton';
import { TooltipProvider } from '@/components/ui/tooltip';
import { type ActiveFlowState, useActiveFlow, type UseActiveFlowResult } from '@/hooks/useActiveFlow';
import { useSettings } from '@/hooks/useSettings';
import { loadDemoFlow } from '@/lib/demo-flow';

export interface AppProps {
  /** Demo mode: the bundled demo flow instead of the active tab's. */
  demo?: boolean;
}

export function App({ demo = false }: AppProps) {
  return demo ? <DemoApp /> : <PanelApp />;
}

function PanelApp() {
  return <Frame active={useActiveFlow()} />;
}

function DemoApp() {
  return <Frame active={useDemoFlow()} demo />;
}

/** The demo flow, loaded once; Refresh has nothing to re-read. */
function useDemoFlow(): UseActiveFlowResult {
  const [state, setState] = useState<ActiveFlowState>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    void loadDemoFlow().then((flow) => {
      if (live) setState({ kind: 'flow', flow });
    });
    return () => {
      live = false;
    };
  }, []);
  return { state, refreshing: false, refresh: () => {} };
}

function Frame({ active, demo = false }: { active: UseActiveFlowResult; demo?: boolean }) {
  const { settings, readiness, loaded, update } = useSettings();
  return (
    <TooltipProvider>
      {loaded ? <Shell state={active.state} refreshing={active.refreshing} onRefresh={active.refresh} readiness={readiness} settings={settings} onUpdateSettings={update} demo={demo} /> : <Skeleton />}
    </TooltipProvider>
  );
}
