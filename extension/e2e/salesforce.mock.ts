import fs from 'node:fs';
import path from 'node:path';

import type { BrowserContext, Worker } from '@playwright/test';

import { expect } from './extension.fixture';

// Salesforce, mocked at the network layer for the real-Chromium specs: the
// Tooling API answers for two synthetic flows and the Lightning tab host
// serves a stub page. No request leaves the machine.

export const VERSION_ID = '301XXXX0000ABCDxyz';
export const DEFINITION_ID = '300XXXX0000ABCDxyz';
export const SECOND_VERSION_ID = '301XXXX0000SECONDx';
export const SECOND_DEFINITION_ID = '300XXXX0000SECONDx';
export const ORG_ID = '00DXXXXXXXXXXXX';
export const SID = `${ORG_ID}!syntheticSessionToken`;

export const TAB_HOST = 'mycompany.lightning.force.com';
export const API_HOST = 'mycompany.my.salesforce.com';
const BUILDER = `https://${TAB_HOST}/builder_platform_interaction/flowBuilder.app`;
export const FLOW_A = `${BUILDER}?flowId=${VERSION_ID}`;
export const FLOW_B = `${BUILDER}?flowId=${SECOND_VERSION_ID}`;
export const FLOWS_LIST = `https://${TAB_HOST}/lightning/setup/Flows/home`;
export const FLOW_A_LABEL = 'Synthetic Test Flow';

/** The chat-history key the panel derives for flow A. */
export const CHAT_KEY = `chat:${ORG_ID}:${DEFINITION_ID}`;

export const syntheticFlow = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../test/fixtures/synthetic-flow.json'), 'utf8')) as unknown;

declare const chrome: {
  storage: { local: { set(items: Record<string, unknown>): Promise<void>; get(keys: string | string[]): Promise<Record<string, unknown>> } };
};

/** Sets the session cookie and mocks both Salesforce hosts. Returns the Tooling paths called, in order. */
export async function mockSalesforce(context: BrowserContext): Promise<string[]> {
  await context.addCookies([{ name: 'sid', value: SID, domain: API_HOST, path: '/', secure: true }]);
  const toolingCalls: string[] = [];
  await context.route(`https://${API_HOST}/**`, async (route) => {
    const url = new URL(route.request().url());
    toolingCalls.push(url.pathname);
    expect(route.request().headers()['authorization']).toBe(`Bearer ${SID}`);
    const versionId = /\/tooling\/sobjects\/Flow\/([A-Za-z0-9]+)$/.exec(url.pathname)?.[1];
    if (versionId) {
      const second = versionId === SECOND_VERSION_ID;
      return route.fulfill({
        json: {
          Id: versionId,
          VersionNumber: second ? 2 : 4,
          Status: second ? 'Active' : 'Draft',
          MasterLabel: second ? 'Second Synthetic Flow' : FLOW_A_LABEL,
          DefinitionId: second ? SECOND_DEFINITION_ID : DEFINITION_ID,
          ProcessType: 'AutoLaunchedFlow',
          LastModifiedDate: '2026-09-01T10:00:00.000+0000',
          Metadata: syntheticFlow,
        },
      });
    }
    if (url.pathname.includes('/tooling/query/')) {
      return route.fulfill({
        json: {
          records: [{ Id: DEFINITION_ID, ActiveVersionId: null, ActiveVersion: null, LatestVersionId: VERSION_ID, LatestVersion: { VersionNumber: 4 } }],
        },
      });
    }
    return route.fulfill({ status: 404, body: 'unexpected' });
  });
  // Salesforce tab hosts never reach the network: any document is a stub page.
  await context.route(`https://${TAB_HOST}/**`, (route) => route.fulfill({ contentType: 'text/html', body: '<title>stub</title>' }));
  return toolingCalls;
}

/** The settings record of a panel whose Anthropic key was validated. */
export const READY_SETTINGS = {
  version: 1,
  activeProvider: 'anthropic',
  modelByProvider: { anthropic: 'claude-sonnet-5', openai: 'gpt-5.6-terra', google: 'gemini-3.5-flash' },
  keys: {
    anthropic: {
      status: 'validated',
      last4: 'wxyz',
      models: [
        { id: 'claude-sonnet-5', maxInputTokens: 1_000_000 },
        { id: 'claude-haiku-4-5-20251001', maxInputTokens: 200_000 },
      ],
      checkedAt: 1,
    },
    openai: { status: 'unset', last4: null, models: [], checkedAt: null },
    google: { status: 'unset', last4: null, models: [], checkedAt: null },
  },
  rememberOnDevice: true,
  theme: 'system',
  detail: 'balanced',
  customInstructions: '',
};

export const SEEDED_KEY = 'test-key-wxyz';

export async function seedStorage(worker: Worker, items: Record<string, unknown>): Promise<void> {
  await worker.evaluate((items) => chrome.storage.local.set(items), items);
}

export async function readStorage(worker: Worker, key: string): Promise<unknown> {
  return worker.evaluate(async (key) => (await chrome.storage.local.get(key))[key], key);
}

/** A validated Anthropic key in storage, so the panel is past "Set up your AI". */
export async function seedReadyKey(worker: Worker): Promise<void> {
  await seedStorage(worker, { settings: READY_SETTINGS, 'apiKey:anthropic': SEEDED_KEY });
}
