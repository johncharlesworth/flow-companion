import type { BrowserContext, Page } from '@playwright/test';

import { expect, test } from './extension.fixture';
import { installProviderMock, messageCalls, providerCalls } from './provider-mock';
import { FLOW_A, FLOW_A_LABEL, mockSalesforce, seedReadyKey } from './salesforce.mock';

// Draw this flow in a real Chromium: the chip sends
// the draw contract and a mocked Mermaid answer renders as an SVG; the renderer
// chunk is not loaded until then; Open in Excalidraw writes Excalidraw's paste payload, opens excalidraw.com (stubbed
// here, nothing leaves the machine), and shows the hint; the follow-up chips
// send their variants; a broken diagram shows the failure line and Try again
// re-sends the same question.

const DIAGRAM = '```mermaid\nflowchart TD\n  A["Account is updated"] --> B{"Enterprise account?"}\n  B -->|Yes| C["Update the account"]\n  B -->|No| D["Assign a follow-up owner"]\n  C --> E["Create a follow-up task"]\n  D --> E\n```\n\nThe flow branches once on the account type and always ends with a task.';
const EVERY = '```mermaid\nflowchart TD\n  Start --> CheckCustomerType{"CheckCustomerType"}\n  CheckCustomerType -->|Enterprise| UpdateAccount["UpdateAccount"]\n  CheckCustomerType -->|SMB| AssignFollowupOwner["AssignFollowupOwner"]\n  UpdateAccount --> CreateFollowupTask["CreateFollowupTask"]\n  AssignFollowupOwner --> CreateFollowupTask\n```\n\nEvery element by API name.';
const BROKEN = '```mermaid\nflowchart TD\n  A["Start"] --> \n  B[[[\n```\n\nThat did not come out right.';

declare global {
  interface Window {
    __clip?: string[];
  }
}

/** A recording clipboard (the real one needs a focused, permitted document) and a stub for excalidraw.com. */
async function prepare(context: BrowserContext) {
  await context.addInitScript(() => {
    window.__clip = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (text: string) => {
          window.__clip!.push(text);
        },
      },
      configurable: true,
    });
  });
  await context.route('https://excalidraw.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>excalidraw stub</title>' }));
}

async function openFlow(context: BrowserContext, extensionId: string) {
  const panel = await context.newPage();
  const requests: string[] = [];
  panel.on('request', (r) => requests.push(r.url()));
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const flowTab = await context.newPage();
  await flowTab.goto(FLOW_A);
  await flowTab.bringToFront();
  await expect(panel.getByRole('heading', { level: 1 })).toHaveText(FLOW_A_LABEL);
  return { panel, flowTab, requests };
}

const lastClip = (panel: Page) => panel.evaluate(() => window.__clip?.at(-1) ?? '');
/** The text of the last user message in a recorded request (the first message's content is an array: flow block, then the turn). */
function lastUserText(body: unknown): string {
  const messages = (body as { messages: { role: string; content: string | { text?: string }[] }[] }).messages;
  const last = [...messages].reverse().find((m) => m.role === 'user');
  return typeof last?.content === 'string' ? last.content : (last?.content.at(-1)?.text ?? '');
}
const loadedScripts = async (panel: Page, requests: string[]) => [...requests, ...(await panel.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name)))];

test('the Draw chip sends the contract; the diagram renders as an SVG and only then loads the renderer; Open in Excalidraw works; the chips follow up', async ({ context, extensionId, serviceWorker }) => {
  await prepare(context);
  await installProviderMock(context, { answers: [{ chunks: DIAGRAM.split(/(?<=\n)/), delayMs: 15 }, { chunks: [EVERY], delayMs: 10 }, { chunks: [DIAGRAM], delayMs: 10 }] });
  await mockSalesforce(context);
  await seedReadyKey(serviceWorker);
  const { panel, flowTab, requests } = await openFlow(context, extensionId);

  expect((await loadedScripts(panel, requests)).filter((u) => /mermaid/i.test(u))).toEqual([]); // the panel starts without the renderer
  await panel.getByRole('button', { name: 'Draw this flow' }).click();
  await expect(panel.getByRole('log').getByText('Draw', { exact: true })).toBeVisible(); // the pill
  const svg = panel.locator('.flow-diagram svg');
  await expect(svg).toBeVisible({ timeout: 20_000 });
  expect(await panel.locator('.flow-diagram svg .node').count()).toBe(5);
  await expect(panel.getByText(/Couldn’t draw this one/)).toHaveCount(0);
  expect((await loadedScripts(panel, requests)).filter((u) => /mermaid-render\.lazy/.test(u)).length).toBeGreaterThan(0);
  await expect(panel.getByText(/A simplified picture, drawn by Anthropic from the saved version/)).toBeVisible();
  await expect(panel.getByText(/Names not in this flow/)).toHaveCount(0);

  const [sent] = messageCalls(await providerCalls(panel));
  const body = sent?.body as { messages: { content: { text: string }[] }[] };
  expect(body.messages[0]?.content[1]?.text).toContain('<response_contract mode="draw" variant="business">');
  expect(body.messages[0]?.content[1]?.text).toContain('<user_question>\nDraw this flow.\n</user_question>');

  await expect(panel.getByText(/Opens excalidraw\.com in a new tab with the picture on your clipboard\. Paste it there with (⌘V|Ctrl\+V) to edit it\. Or/)).toBeVisible(); // readable before the click
  await expect(panel.getByRole('button', { name: 'Copy', exact: true })).toHaveCount(0); // one button; the Mermaid route is a link in the sentence
  await panel.getByRole('button', { name: 'copy the Mermaid text' }).click();
  expect(await lastClip(panel)).toMatch(/^flowchart TD\n {2}A\["Account is updated"\]/);

  const [excalidraw] = await Promise.all([context.waitForEvent('page'), panel.getByRole('button', { name: 'Open in Excalidraw' }).click()]);
  expect(new URL(excalidraw.url()).host).toBe('excalidraw.com');
  const payload = JSON.parse(await lastClip(panel)) as { type: string; elements: { type: string }[] };
  expect(payload.type).toBe('excalidraw-api/clipboard');
  expect(payload.elements.length).toBeGreaterThanOrEqual(5 + 5); // five shapes, five arrows, plus labels
  // The panel follows the tab: with Excalidraw in front it shows "Not on Salesforce" with the paste instruction.
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Not on Salesforce');
  await expect(panel.getByText(/^Your diagram is on the clipboard\. Press (⌘V|Ctrl\+V) on the Excalidraw canvas, then come back to your Flow tab to keep chatting\.$/)).toBeVisible();
  // Back on the flow: the chat and its picture are back, the note is gone.
  await flowTab.bringToFront();
  await expect(panel.getByRole('heading', { level: 1 })).toHaveText(FLOW_A_LABEL);
  await expect(panel.locator('.flow-diagram svg')).toBeVisible({ timeout: 20_000 });
  await excalidraw.close();
  await expect(panel.getByText(/Your diagram is on the clipboard/)).toHaveCount(0);

  // Follow-up: every element (the pill plus the chip's words as the question), and that picture hides its own chip.
  await panel.getByRole('button', { name: 'Draw every element' }).click();
  await expect(panel.locator('.flow-diagram svg')).toHaveCount(2, { timeout: 20_000 });
  expect(lastUserText(messageCalls(await providerCalls(panel))[1]?.body)).toContain('<response_contract mode="draw" variant="admins">');
  await expect(panel.getByRole('button', { name: 'Draw every element' })).toHaveCount(1); // only under the first picture
  await expect(panel.getByRole('button', { name: 'Draw one element…' })).toHaveCount(2);

  // Follow-up: around one element, through the picker, sent on selection.
  await panel.getByRole('button', { name: 'Draw one element…' }).last().click();
  await expect(panel.getByText('Draw one element', { exact: true })).toBeVisible();
  await panel.getByLabel('Search elements').fill('customer');
  await panel.getByRole('option', { name: /CheckCustomerType/ }).click();
  await expect(panel.locator('.flow-diagram svg')).toHaveCount(3, { timeout: 20_000 });
  const turn = lastUserText(messageCalls(await providerCalls(panel))[2]?.body);
  expect(turn).toContain('<response_contract mode="draw" variant="fromElement">');
  expect(turn).toContain('<focus_element name="CheckCustomerType">');
  expect(turn).toContain('Draw this flow around CheckCustomerType.');
  await expect(panel.getByRole('log').getByText('CheckCustomerType', { exact: true }).first()).toBeVisible(); // the element chip in the bubble
});

test('a diagram Mermaid cannot parse shows the failure line and Try again, which re-sends the same question once', async ({ context, extensionId, serviceWorker }) => {
  await prepare(context);
  await installProviderMock(context, { answers: [{ chunks: [BROKEN], delayMs: 10 }, { chunks: [DIAGRAM], delayMs: 10 }] });
  await mockSalesforce(context);
  await seedReadyKey(serviceWorker);
  const { panel } = await openFlow(context, extensionId);

  // Draw one element is reachable before any picture exists, from the quick-actions menu.
  await panel.getByRole('button', { name: 'Quick actions' }).click();
  await panel.getByRole('menuitem', { name: 'Draw one element…' }).click();
  await expect(panel.getByText('Draw one element', { exact: true })).toBeVisible();
  await panel.getByLabel('Search elements').press('Escape');
  await expect(panel.getByLabel('Message')).toBeEnabled();

  await panel.getByRole('button', { name: 'Quick actions' }).click();
  await panel.getByRole('menuitem', { name: 'Draw this flow' }).click();
  await expect(panel.getByText('Couldn’t draw this one. The text it was working from is below.')).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByRole('log')).toContainText('B[[[');
  await expect(panel.getByRole('button', { name: 'Open in Excalidraw' })).toHaveCount(0);
  await expect(panel.getByText(/A simplified picture/)).toHaveCount(0);
  await expect(panel.getByText('Interrupted')).toHaveCount(0); // the answer itself finished; only the picture failed

  await panel.getByRole('button', { name: 'Try again' }).click();
  await expect(panel.locator('.flow-diagram svg')).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText(/Couldn’t draw this one/)).toHaveCount(0);
  const calls = messageCalls(await providerCalls(panel));
  expect(calls).toHaveLength(2);
  expect((calls[1]?.body as { messages: unknown[] }).messages).toEqual((calls[0]?.body as { messages: unknown[] }).messages);
  expect(await panel.getByRole('log').getByText('Draw', { exact: true }).count()).toBe(1); // no duplicate bubble
});

test('with an element attached, the Draw chip and menu row draw from that element', async ({ context, extensionId, serviceWorker }) => {
  await prepare(context);
  await installProviderMock(context, { answers: [{ chunks: [DIAGRAM], delayMs: 10 }] });
  await mockSalesforce(context);
  await seedReadyKey(serviceWorker);
  const { panel } = await openFlow(context, extensionId);

  await panel.getByRole('button', { name: 'Explain an element' }).click();
  await panel.getByLabel('Search elements').fill('customer');
  await panel.getByRole('option', { name: /CheckCustomerType/ }).click();
  await expect(panel.getByRole('button', { name: 'Remove CheckCustomerType' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Draw CheckCustomerType' })).toBeVisible(); // the chip
  await panel.getByRole('button', { name: 'Quick actions' }).click();
  await expect(panel.getByRole('menuitem', { name: 'Draw CheckCustomerType' })).toBeVisible();
  await expect(panel.getByRole('menuitem', { name: 'Draw one element…' })).toHaveCount(0); // redundant while one is attached
  await panel.getByRole('menuitem', { name: 'Draw CheckCustomerType' }).click();

  await expect(panel.locator('.flow-diagram svg')).toBeVisible({ timeout: 20_000 });
  const turn = lastUserText(messageCalls(await providerCalls(panel))[0]?.body);
  expect(turn).toContain('<response_contract mode="draw" variant="fromElement">');
  expect(turn).toContain('<focus_element name="CheckCustomerType">');
  await expect(panel.getByRole('button', { name: 'Remove CheckCustomerType' })).toHaveCount(0); // the chip is spent
});
