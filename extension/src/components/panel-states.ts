// Copy for every state the panel can be in. The design wins on copy.

import { Compass, KeyRound, LogIn, Save, ShieldAlert, WifiOff, Workflow } from 'lucide-react';

import type { ActiveFlowState } from '@/hooks/useActiveFlow';
import { type ExcalidrawRoute, excalidrawPendingNote } from '@/lib/excalidraw-export';
import type { SfErrorKind } from '@/lib/sf-error-kind';

import type { PanelStateProps } from './PanelState';

export const DISCLOSURE_GENERIC =
  'When you chat, this flow’s saved metadata is sent to the AI provider you choose, under your key. Nothing else leaves your browser.';

export type SetUpVariant = 'first' | 'forgotten' | 'unchecked';

/**
 * The gate state. `first`: no key yet. `forgotten`: the key was not remembered
 * and Chrome restarted. `unchecked`: a key is saved but its check never
 * completed, so the user needs to check it again rather than paste it again.
 */
export function setUpAiState(variant: SetUpVariant, onSetUp: () => void, providerLabel = 'your provider'): PanelStateProps {
  if (variant === 'unchecked') {
    return {
      icon: KeyRound,
      title: 'Check your key',
      body: `Your key is saved, but ${providerLabel} couldn’t be reached to check it. Open Settings and check again.`,
      note: DISCLOSURE_GENERIC,
      action: { label: 'Open Settings', onClick: onSetUp },
    };
  }
  return {
    icon: KeyRound,
    title: 'Set up your AI',
    body:
      variant === 'forgotten'
        ? 'Your key was forgotten when Chrome closed, as you chose. Paste it again to continue.'
        : 'Flow Companion uses an AI account you own. Paste a key from Anthropic, OpenAI, or Google.',
    note: DISCLOSURE_GENERIC,
    action: { label: 'Set up your AI', onClick: onSetUp },
  };
}

const API_ERROR: Record<SfErrorKind, { title: string; body: string; retry: boolean }> = {
  apiDisabled: {
    title: 'API access is blocked',
    body: 'Your org or profile blocks API access, which this extension needs. Check Setup → Profiles → your profile → API Enabled, and Setup → API Access Control.',
    retry: false,
  },
  insufficientAccess: {
    title: 'No permission to read this flow',
    body: 'Your user can’t read flow metadata. Ask an admin about the View Setup and Configuration permission on your profile.',
    retry: false,
  },
  forbidden: {
    title: 'Salesforce refused the request',
    body: 'Your org refused this extension’s request. Check Setup → Profiles → your profile → API Enabled, and Setup → API Access Control.',
    retry: false,
  },
  proxyBlocked: {
    title: 'Not supported behind this proxy',
    body: 'This org sits behind a corporate proxy, such as Microsoft Defender for Cloud Apps, that blocks extensions. Flow Companion doesn’t support that setup.',
    retry: false,
  },
  orgApiLimitReached: {
    title: 'Your org hit its API limit',
    body: 'Your org has used all of its API requests for now. Try again after the limit resets, or check Setup → System Overview.',
    retry: true,
  },
  network: {
    title: 'Can’t reach Salesforce',
    body: 'Check your connection, then try again.',
    retry: true,
  },
  sessionExpired: {
    title: 'Session expired',
    body: 'Your Salesforce session has expired. Reload the Salesforce tab and sign in again. If this keeps happening, your org’s MFA policy may block API access from extensions.',
    retry: true,
  },
  unknown: {
    title: 'Couldn’t read this flow',
    body: 'Something went wrong reading this flow. Reload the Salesforce tab and try again.',
    retry: true,
  },
};

/**
 * The state component's props for a tab state, or null when the panel shows
 * something else (loading, a flow). `excalidrawPending`: the panel follows the
 * tab, so right after Open in Excalidraw it shows "Not on Salesforce" with the
 * paste instruction as its note.
 */
export function describeState(state: ActiveFlowState, actions: { refresh: () => void; excalidrawPending?: ExcalidrawRoute | null }): PanelStateProps | null {
  switch (state.kind) {
    case 'loading':
    case 'flow':
      return null;
    case 'notOnSalesforce':
      return {
        icon: Compass,
        title: 'Not on Salesforce',
        body: 'Open a Salesforce org to get started, then open any Flow.',
        ...(actions.excalidrawPending ? { note: excalidrawPendingNote(actions.excalidrawPending) } : {}),
      };
    case 'notOnFlowPage':
      return { icon: Workflow, title: 'Open a Flow', body: 'Go to Setup → Flows and open one. This panel follows the tab.' };
    case 'unsavedFlow':
      return { icon: Save, title: 'Save this flow first', body: 'Flow Companion reads the last saved version. Save, then this panel will pick it up.' };
    case 'noSession':
      return {
        icon: LogIn,
        title: 'Session expired',
        body: 'Flow Companion can’t find your Salesforce session. Sign out of Salesforce and back in, then check again.',
        action: { label: 'Check again', onClick: actions.refresh },
      };
    case 'error': {
      const copy = API_ERROR[state.errorKind];
      const icon = state.errorKind === 'sessionExpired' ? LogIn : state.errorKind === 'network' ? WifiOff : ShieldAlert;
      return {
        icon,
        title: copy.title,
        body: copy.body,
        ...(copy.retry
          ? { action: { label: state.errorKind === 'sessionExpired' ? 'Check again' : 'Try again', onClick: actions.refresh } }
          : {}),
      };
    }
  }
}
