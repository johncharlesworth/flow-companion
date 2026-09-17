import type { Page } from '@playwright/test';

import { expect, test } from './extension.fixture';
import { FLOW_A, FLOW_B, FLOWS_LIST, mockSalesforce, seedReadyKey } from './salesforce.mock';

// Step-2 acceptance in a real Chromium: the panel (opened as a tab so Playwright
// can read it) follows real tab activations in its own window, and a tab change
// in another window does nothing. Salesforce is mocked at the network layer;
// no request leaves the machine.

declare const chrome: {
  windows: { create(info: { url: string }): Promise<{ id: number; tabs?: { id: number }[] }> };
  tabs: { update(id: number, info: { active: boolean }): Promise<unknown> };
};

test('the panel follows the active tab of its own window, and ignores other windows', async ({ context, extensionId, serviceWorker }) => {
  await seedReadyKey(serviceWorker);
  const toolingCalls = await mockSalesforce(context);

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const readout = panel.locator('main p').first();
  const title = panel.getByRole('heading', { level: 1 });

  const flowTab = await context.newPage();
  await flowTab.goto(FLOW_A);
  await flowTab.bringToFront();
  await expect(title).toHaveText('Synthetic Test Flow');
  await expect(panel.getByText('v4 · Draft')).toBeVisible();
  expect(toolingCalls).toHaveLength(2);

  // 1. switch tab: a non-Salesforce tab, then the Flows list page
  const otherTab = await context.newPage();
  await otherTab.goto('about:blank');
  await otherTab.bringToFront();
  await expect(readout).toHaveText(/Open a Salesforce org/);
  const listTab = await context.newPage();
  await listTab.goto(FLOWS_LIST);
  await listTab.bringToFront();
  await expect(readout).toHaveText(/Go to Setup → Flows/);
  expect(toolingCalls).toHaveLength(2);

  // 3. return to the first flow: it reloads with the same identity
  await flowTab.bringToFront();
  await expect(title).toHaveText('Synthetic Test Flow');
  expect(toolingCalls).toHaveLength(4);

  // 2. open a second flow in the same tab (URL change)
  await flowTab.goto(FLOW_B);
  await expect(title).toHaveText('Second Synthetic Flow');
  await expect(panel.getByText('v2 · Active')).toBeVisible();
  expect(toolingCalls).toHaveLength(6);

  // 4. a tab change in another Chrome window does nothing
  const otherWindow = await serviceWorker.evaluate(() => chrome.windows.create({ url: 'about:blank' }));
  const otherWindowTab = otherWindow.tabs?.[0]?.id;
  expect(otherWindowTab).toBeTruthy();
  await serviceWorker.evaluate((id) => chrome.tabs.update(id, { active: true }), otherWindowTab!);
  await panel.waitForTimeout(500);
  await expect(title).toHaveText('Second Synthetic Flow');
  await expect(panel.getByText('v2 · Active')).toBeVisible();
  expect(toolingCalls).toHaveLength(6);
});

test('a panel opened on a non-Salesforce tab explains what to open', async ({ context, extensionId, serviceWorker }) => {
  await seedReadyKey(serviceWorker);
  const other = await context.newPage();
  await other.goto('about:blank');
  const panel: Page = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await other.bringToFront();
  await expect(panel.locator('main p').first()).toHaveText(/Open a Salesforce org/);
});

test('with no key, the panel asks to set up your AI before anything else', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Set up your AI');
  await panel.getByRole('button', { name: 'Set up your AI' }).click();
  await expect(panel.getByRole('heading', { level: 1 })).toHaveText('Settings');
  await expect(panel.getByText('Anthropic · Claude models')).toBeVisible();
});
