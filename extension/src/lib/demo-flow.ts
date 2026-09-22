// Demo mode: the demo-flow links ("See it on a demo flow first" before
// there is a key, "Try a demo flow" after) open the panel as a normal tab on
// a bundled demo flow, so anyone can try the extension without a Salesforce
// org. The four actions play recorded answers, with or without a key; nothing
// is ever sent. The sample is the synthetic test flow, loaded on demand so the
// everyday panel does not carry it. Nothing here touches Salesforce: no
// cookie, no Tooling call.

import type { ActiveFlow } from '@/hooks/useActiveFlow';
import { chatKey } from '@/lib/chat-history';
import { DEMO_LABEL, demoSample } from '@/lib/demo-sample';
import { normalizeFlow } from '@/lib/flow-normalizer';

export const DEMO_PARAM = 'demo';
/** Relative to the extension's origin; opened from the panel and from Settings in a new tab. */
export const DEMO_PATH = `/sidepanel.html?${DEMO_PARAM}=1`;
export const DEMO_ORG_ID = 'demo';
export { DEMO_LABEL };
const DEMO_VERSION_ID = '301XXXX0000ABCDxyz';
const DEMO_DEFINITION_ID = '300XXXX0000ABCDxyz';

export function isDemoRequested(search: string): boolean {
  return new URLSearchParams(search).get(DEMO_PARAM) === '1';
}

/** The demo flow as the panel would have read it from an org, saved "just now". */
export async function loadDemoFlow(now: number = Date.now()): Promise<ActiveFlow> {
  const { default: raw } = await import('@@/test/fixtures/synthetic-flow.json');
  const sample = demoSample(raw);
  const record = {
    Id: DEMO_VERSION_ID,
    VersionNumber: 4,
    Status: 'Active',
    MasterLabel: DEMO_LABEL,
    DefinitionId: DEMO_DEFINITION_ID,
    ProcessType: 'AutoLaunchedFlow',
    LastModifiedDate: new Date(now).toISOString(),
    Metadata: sample,
  };
  return {
    key: chatKey(DEMO_ORG_ID, DEMO_DEFINITION_ID),
    sfHost: 'demo',
    orgId: DEMO_ORG_ID,
    route: { kind: 'flowVersion', id: DEMO_VERSION_ID },
    loaded: {
      record,
      definition: { Id: DEMO_DEFINITION_ID, ActiveVersionId: DEMO_VERSION_ID, ActiveVersionNumber: 4, LatestVersionId: DEMO_VERSION_ID, LatestVersionNumber: 4 },
    },
    metadata: normalizeFlow(sample),
  };
}
