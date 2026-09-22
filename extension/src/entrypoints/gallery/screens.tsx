import type { ReactNode } from 'react';
import { browser } from 'wxt/browser';

import { Shell } from '@/components/Shell';
import type { ActiveFlowState } from '@/hooks/useActiveFlow';
import type { LoadedFlow } from '@/lib/flow-extractor';
import { normalizeFlow } from '@/lib/flow-normalizer';
import { defaultSettings } from '@/lib/settings';
import syntheticFlow from '@@/test/fixtures/synthetic-flow.json';

const SF_HOST = 'mycompany.my.salesforce.com';
export const NOW = Date.parse('2026-09-03T12:03:00.000Z');
const noop = () => {};

function loaded(overrides: { version?: number; status?: string; latest?: number | null; active?: number | null; label?: string } = {}): ActiveFlowState {
  const version = overrides.version ?? 4;
  const flow: LoadedFlow = {
    record: {
      Id: '301XXXX0000ABCDxyz',
      VersionNumber: version,
      Status: overrides.status ?? 'Draft',
      MasterLabel: overrides.label ?? 'Customer Tier Routing Flow',
      DefinitionId: '300XXXX0000ABCDxyz',
      ProcessType: 'AutoLaunchedFlow',
      LastModifiedDate: '2026-09-03T12:00:00.000Z',
      Metadata: syntheticFlow,
    },
    definition: {
      Id: '300XXXX0000ABCDxyz',
      ActiveVersionId: overrides.active === null ? null : '301XXXX0000ACTIVEx',
      ActiveVersionNumber: overrides.active === undefined ? 3 : overrides.active,
      LatestVersionId: '301XXXX0000LATESTx',
      LatestVersionNumber: overrides.latest === undefined ? version : overrides.latest,
    },
  };
  return {
    kind: 'flow',
    flow: { key: 'chat:00DXXXXXXXXXXXX:300XXXX0000ABCDxyz', sfHost: SF_HOST, orgId: '00DXXXXXXXXXXXX', route: { kind: 'flowVersion', id: flow.record.Id }, loaded: flow, metadata: normalizeFlow(syntheticFlow) },
  };
}

const READY = { ready: true, forgotten: false, unchecked: false };
const SETTINGS = (() => { const s = defaultSettings(); return { ...s, activeProvider: 'anthropic' as const, keys: { ...s.keys, anthropic: { status: 'validated' as const, last4: 'wxyz', models: [{ id: 'claude-sonnet-5', maxInputTokens: 1_000_000 }, { id: 'claude-opus-5', maxInputTokens: 1_000_000 }, { id: 'claude-haiku-4-5-20251001', maxInputTokens: 200_000 }], checkedAt: 1 } } }; })();
const noUpdate = async () => {};
const shell = (state: ActiveFlowState, refreshing = false) => <Shell state={state} refreshing={refreshing} onRefresh={noop} readiness={READY} settings={SETTINGS} onUpdateSettings={noUpdate} now={NOW} />;

export const SCREENS: Record<string, () => ReactNode> = {
  'flow-draft': () => shell(loaded()),
  'flow-active': () => shell(loaded({ status: 'Active', active: 4 })),
  'flow-obsolete': () => shell(loaded({ version: 2, status: 'Obsolete', latest: 5, active: 5, label: 'Lane Four - Opportunity After Save With A Very Long Name' })),
  'flow-refreshing': () => shell(loaded(), true),
  conversation: () => shell(loaded()),
  diagram: () => shell(loaded()),
  'conversation-errors': () => shell(loaded()),
  loading: () => shell({ kind: 'loading' }),
  'not-on-salesforce': () => shell({ kind: 'notOnSalesforce' }),
  'open-a-flow': () => shell({ kind: 'notOnFlowPage', sfHost: SF_HOST }),
  'save-first': () => shell({ kind: 'unsavedFlow', sfHost: SF_HOST }),
  'no-session': () => shell({ kind: 'noSession', sfHost: SF_HOST }),
  'session-expired': () => shell({ kind: 'error', errorKind: 'sessionExpired', sfHost: SF_HOST }),
  'api-disabled': () => shell({ kind: 'error', errorKind: 'apiDisabled', sfHost: SF_HOST }),
  'proxy-blocked': () => shell({ kind: 'error', errorKind: 'proxyBlocked', sfHost: SF_HOST }),
  network: () => shell({ kind: 'error', errorKind: 'network', sfHost: SF_HOST }),
  'set-up-ai': () => <Shell state={loaded()} refreshing={false} onRefresh={noop} readiness={{ ready: false, forgotten: false, unchecked: false }} settings={SETTINGS} onUpdateSettings={noUpdate} now={NOW} />,
  'set-up-ai-forgotten': () => <Shell state={loaded()} refreshing={false} onRefresh={noop} readiness={{ ready: false, forgotten: true, unchecked: false }} settings={SETTINGS} onUpdateSettings={noUpdate} now={NOW} />,
  'set-up-ai-unchecked': () => <Shell state={loaded()} refreshing={false} onRefresh={noop} readiness={{ ready: false, forgotten: false, unchecked: true }} settings={SETTINGS} onUpdateSettings={noUpdate} now={NOW} />,
  // The demo flow with no key: the four actions play recorded answers and the message box is off, with the link to set a key up.
  'demo-recorded': () => <Shell demo state={loaded({ status: 'Active', active: 4 })} refreshing={false} onRefresh={noop} readiness={{ ready: false, forgotten: false, unchecked: false }} settings={defaultSettings()} onUpdateSettings={noUpdate} now={NOW} />,
  'settings-first-run': () => <Shell state={{ kind: 'notOnSalesforce' }} refreshing={false} onRefresh={noop} readiness={{ ready: false, forgotten: false, unchecked: false }} settings={SETTINGS} onUpdateSettings={noUpdate} now={NOW} initialView="settings" />,
  settings: () => <Shell state={{ kind: 'notOnSalesforce' }} refreshing={false} onRefresh={noop} readiness={READY} settings={SETTINGS} onUpdateSettings={noUpdate} now={NOW} initialView="settings" />,
  'settings-key-saved': () => <Shell state={{ kind: 'notOnSalesforce' }} refreshing={false} onRefresh={noop} readiness={READY} settings={SETTINGS} onUpdateSettings={noUpdate} now={NOW} initialView="settings" />,
};

/** Storage to seed before a screen renders (the gallery runs in a fresh profile). */
const ANSWER = `## Purpose\n\nThis flow routes **Account** updates by customer type.\n\n- **Enterprise** accounts go to \`UpdateAccount\`\n- **SMB** accounts go straight to \`AssignFollowupOwner\`\n\n| Element | Type |\n|---|---|\n| CheckCustomerType | Decision |\n| CreateFollowupTask | Create Records |\n\n\`\`\`\nAND({!$Record.AnnualRevenue} > 1000000, {!AccountAgeInDays} > 365)\n\`\`\``;
const KEY = 'chat:00DXXXXXXXXXXXX:300XXXX0000ABCDxyz';

const DIAGRAM = `\`\`\`mermaid
flowchart TD
  A["An account is updated"] --> B{"Is it an enterprise account?"}
  B -->|Yes| C["Update the account"]
  B -->|No| D["Assign a follow-up owner"]
  C --> E["Create a follow-up task"]
  D --> E
\`\`\`

The flow branches once, on the account type. Enterprise accounts are updated first; every account ends with a follow-up task.`;

export const SEEDS: Record<string, () => Promise<void>> = {
  diagram: async () => {
    await browser.storage.local.set({
      [KEY]: {
        key: KEY,
        updatedAt: NOW,
        turns: [
          { role: 'user', displayText: '', sentText: 'x', mode: 'draw', variant: 'business', timestamp: NOW - 60_000 },
          { role: 'assistant', displayText: DIAGRAM, stopReason: 'end', timestamp: NOW - 50_000 },
        ],
      },
    });
  },
  conversation: async () => {
    await browser.storage.local.set({
      [KEY]: {
        key: KEY,
        updatedAt: NOW,
        turns: [
          { role: 'user', displayText: 'What does this flow do?', sentText: 'What does this flow do?', mode: 'ask', timestamp: NOW - 60_000 },
          { role: 'assistant', displayText: ANSWER, stopReason: 'end', timestamp: NOW - 50_000 },
          { role: 'user', displayText: '', sentText: 'x', mode: 'overview', timestamp: NOW - 40_000 },
          { role: 'assistant', displayText: 'It is a record-triggered flow on Account that assigns an owner and creates a follow-up task.', stopReason: 'end', reread: true, timestamp: NOW - 30_000 },
          { role: 'notice', displayText: 'Switched to Claude Opus 5', timestamp: NOW - 20_000 },
        ],
      },
    });
  },
  'conversation-errors': async () => {
    await browser.storage.local.set({
      [KEY]: {
        key: KEY,
        updatedAt: NOW,
        turns: [
          { role: 'user', displayText: 'Why does it branch?', sentText: 'Why does it branch?', mode: 'explain', focusElement: 'CheckCustomerType', timestamp: NOW - 60_000 },
          { role: 'assistant', displayText: 'The decision compares `$Record.AccountType`', interrupted: 'stopped', timestamp: NOW - 50_000 },
          { role: 'user', displayText: 'Document this flow', sentText: 'x', mode: 'document', timestamp: NOW - 40_000 },
          { role: 'assistant', displayText: '# Customer Tier Routing Flow\n\n| Field | Value |\n|---|---|\n| Type | Record-triggered |', stopReason: 'max_tokens', timestamp: NOW - 30_000 },
          { role: 'user', displayText: 'And the fault path?', sentText: 'And the fault path?', mode: 'ask', timestamp: NOW - 20_000 },
          { role: 'assistant', displayText: '', interrupted: 'error', timestamp: NOW - 10_000 },
        ],
      },
    });
  },
  'settings-key-saved': async () => {
    await browser.storage.local.set({
      settings: {
        version: 1,
        activeProvider: 'anthropic',
        modelByProvider: { anthropic: 'claude-sonnet-5', openai: 'gpt-5.6-terra', google: 'gemini-3.5-flash' },
        keys: {
          anthropic: { status: 'validated', last4: 'wxyz', models: [{ id: 'claude-sonnet-5', maxInputTokens: 1_000_000 }, { id: 'claude-opus-5', maxInputTokens: 1_000_000 }], checkedAt: 1 },
          openai: { status: 'unset', last4: null, models: [], checkedAt: null },
          google: { status: 'unset', last4: null, models: [], checkedAt: null },
        },
        rememberOnDevice: true,
        theme: 'system',
        detail: 'balanced',
        customInstructions: '',
      },
      'apiKey:anthropic': 'gallery-placeholder-wxyz',
    });
  },
};
