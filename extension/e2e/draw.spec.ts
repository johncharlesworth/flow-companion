
import type { BrowserContext, Page } from '@playwright/test';

import { expect, test } from './extension.fixture';
import { installProviderMock, messageCalls, providerCalls } from './provider-mock';
import { DEFINITION_ID, FLOW_A, FLOW_A_LABEL, mockSalesforce, seedReadyKey, VERSION_ID } from './salesforce.mock';

// Draw this flow in a real Chromium: the card sends
// the draw contract and a mocked Mermaid answer renders as an SVG; the renderer
// chunk is not loaded until then; Open in Excalidraw writes Excalidraw's paste payload, opens excalidraw.com (stubbed
// here, nothing leaves the machine), and shows the hint; the Actions menu
// sends the other two pictures; a broken diagram shows the failure line and Try again
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

test('the Draw chip sends the contract; the diagram renders as an SVG and only then loads the renderer; Open in Excalidraw works; the menu draws the other two', async ({ context, extensionId, serviceWorker }) => {
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

  // No follow-up chips under the picture: the other two pictures are in the Actions menu.
  await expect(panel.getByRole('button', { name: 'Draw every element' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Draw one element' })).toHaveCount(0);

  // Every element, from the menu (the words as the question, so the bubble says what was asked).
  await panel.getByRole('button', { name: 'Actions' }).click();
  await panel.getByRole('menuitem', { name: 'Draw every element' }).click();
  await expect(panel.locator('.flow-diagram svg')).toHaveCount(2, { timeout: 20_000 });
  expect(lastUserText(messageCalls(await providerCalls(panel))[1]?.body)).toContain('<response_contract mode="draw" variant="admins">');
  await expect(panel.getByRole('log').getByText('Draw every element', { exact: true })).toBeVisible();

  // Around one element, from the menu, through the picker, sent on selection.
  await panel.getByRole('button', { name: 'Actions' }).click();
  await panel.getByRole('menuitem', { name: 'Draw one element' }).click();
  await expect(panel.getByText('Draw one element', { exact: true })).toBeVisible();
  await panel.getByLabel('Search elements').fill('customer');
  await panel.getByRole('option', { name: /CheckCustomerType/ }).click();
  await expect(panel.locator('.flow-diagram svg')).toHaveCount(3, { timeout: 20_000 });
  const turn = lastUserText(messageCalls(await providerCalls(panel))[2]?.body);
  expect(turn).toContain('<response_contract mode="draw" variant="fromElement">');
  expect(turn).toContain('<focus_element name="CheckCustomerType">');
  expect(turn).toContain('Draw this flow around CheckCustomerType.');
  await expect(panel.getByRole('log').getByText('CheckCustomerType', { exact: true }).first()).toBeVisible(); // the element's name in the bubble
});

test('when a picture draws below the fold, "Jump to latest" appears and brings its Open in Excalidraw bar into view', async ({ context, extensionId, serviceWorker }) => {
  await prepare(context);
  await installProviderMock(context, { answers: [{ chunks: [DIAGRAM], delayMs: 10 }] });
  await mockSalesforce(context);
  await seedReadyKey(serviceWorker);
  const { panel } = await openFlow(context, extensionId);
  await panel.setViewportSize({ width: 400, height: 480 });
  await panel.getByRole('button', { name: /^Draw this flow/ }).click();
  await expect(panel.locator('.flow-diagram svg')).toBeVisible({ timeout: 20_000 });
  const open = panel.getByRole('button', { name: 'Open in Excalidraw' });
  const log = panel.getByRole('log');
  const below = async () => (await open.boundingBox())!.y + (await open.boundingBox())!.height > (await log.boundingBox())!.y + (await log.boundingBox())!.height;
  expect(await below()).toBe(true); // the picture pushed its bar out of sight
  const jump = panel.getByRole('button', { name: 'Jump to latest' });
  await expect(jump).toBeVisible();
  await jump.click();
  await expect.poll(below).toBe(false);
});

test('a diagram Mermaid cannot parse shows the failure line and Try again, which re-sends the same question once', async ({ context, extensionId, serviceWorker }) => {
  await prepare(context);
  await installProviderMock(context, { answers: [{ chunks: [BROKEN], delayMs: 10 }, { chunks: [DIAGRAM], delayMs: 10 }] });
  await mockSalesforce(context);
  await seedReadyKey(serviceWorker);
  const { panel } = await openFlow(context, extensionId);

  // Draw one element is reachable before any picture exists, from the Actions menu.
  await panel.getByRole('button', { name: 'Actions' }).click();
  await panel.getByRole('menuitem', { name: 'Draw one element' }).click();
  await expect(panel.getByText('Draw one element', { exact: true })).toBeVisible();
  await panel.getByLabel('Search elements').press('Escape');
  await expect(panel.getByLabel('Message')).toBeEnabled();

  await panel.getByRole('button', { name: 'Actions' }).click();
  await panel.getByRole('menuitem', { name: 'Draw main paths' }).click();
  await expect(panel.getByText('Couldn’t draw this one. The text it was working from is below.')).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByRole('log')).toContainText('B[[[');
  await expect(panel.getByRole('button', { name: 'Open in Excalidraw' })).toHaveCount(0);
  await expect(panel.getByText(/A simplified picture/)).toHaveCount(0);
  await expect(panel.getByText('Interrupted')).toHaveCount(0); // the answer itself finished; only the picture failed

  // In the accent ink, not ghost grey: a text-accent className can lose to the ghost variant.
  const tryAgain = panel.getByRole('button', { name: 'Try again' });
  await panel.mouse.move(0, 0);
  await expect.poll(() => tryAgain.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(31, 111, 120)'); // --accent, light
  await tryAgain.click();
  await expect(panel.locator('.flow-diagram svg')).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText(/Couldn’t draw this one/)).toHaveCount(0);
  const calls = messageCalls(await providerCalls(panel));
  expect(calls).toHaveLength(2);
  expect((calls[1]?.body as { messages: unknown[] }).messages).toEqual((calls[0]?.body as { messages: unknown[] }).messages);
  expect(await panel.getByRole('log').getByText('Draw', { exact: true }).count()).toBe(1); // no duplicate bubble
});

test('while an answer is arriving, Actions and the model chip are off, so nothing is chosen only to be dropped', async ({ context, extensionId, serviceWorker }) => {
  await prepare(context);
  const slow = Array.from({ length: 40 }, (_, i) => `word${i + 1} `);
  await installProviderMock(context, { answers: [{ chunks: [DIAGRAM], delayMs: 10 }, { chunks: slow, delayMs: 100 }] });
  await mockSalesforce(context);
  await seedReadyKey(serviceWorker);
  const { panel } = await openFlow(context, extensionId);

  await panel.getByRole('button', { name: /^Draw this flow/ }).click();
  await expect(panel.locator('.flow-diagram svg')).toBeVisible({ timeout: 20_000 });
  const actions = panel.getByRole('button', { name: 'Actions' });
  const model = panel.getByRole('button', { name: 'Claude Sonnet 5' });
  await expect(actions).toBeEnabled();
  await expect(model).toBeEnabled();

  await panel.getByLabel('Message').fill('And the fault paths?');
  await panel.getByLabel('Message').press('Enter');
  await expect(panel.getByRole('log')).toContainText('word2');
  await expect(actions).toBeDisabled();
  // A switch mid-answer would post its note under the answer still arriving, which would then read as interrupted.
  await expect(model).toBeDisabled();

  await panel.getByRole('button', { name: 'Stop' }).click();
  await expect(actions).toBeEnabled();
  await expect(model).toBeEnabled();
});

test('on a flow of more than 100 elements, Draw every element asks first; Draw main paths draws those, and asking again then choosing it draws every one', async ({ context, extensionId, serviceWorker }) => {
  await prepare(context);
  await installProviderMock(context, { answers: [{ chunks: [DIAGRAM], delayMs: 10 }, { chunks: [EVERY], delayMs: 10 }] });
  await mockSalesforce(context);
  // A synthetic chain of 119 assignments in place of the small flow (a later route wins); with Start, which the Outline counts, 120 elements.
  const large = { label: 'Long Chain', processType: 'AutoLaunchedFlow', start: { connector: { targetReference: 'Step_1' } }, assignments: Array.from({ length: 119 }, (_, i) => ({ name: `Step_${i + 1}`, label: `Step ${i + 1}`, assignmentItems: [], ...(i < 118 ? { connector: { targetReference: `Step_${i + 2}` } } : {}) })) };
  await context.route(/\/tooling\/sobjects\/Flow\/[A-Za-z0-9]+$/, (route) => route.fulfill({ json: { Id: VERSION_ID, VersionNumber: 4, Status: 'Draft', MasterLabel: FLOW_A_LABEL, DefinitionId: DEFINITION_ID, ProcessType: 'AutoLaunchedFlow', LastModifiedDate: '2026-09-01T10:00:00.000+0000', Metadata: large } }));
  await seedReadyKey(serviceWorker);
  const { panel } = await openFlow(context, extensionId);

  await panel.getByRole('button', { name: 'Actions' }).click();
  await panel.getByRole('menuitem', { name: 'Draw every element' }).click();
  const ask = panel.getByRole('alertdialog', { name: 'Draw every element?' });
  await expect(ask).toContainText(/^This flow has 120 elements\. Drawing every one can take a couple of minutes\./);
  expect(messageCalls(await providerCalls(panel))).toHaveLength(0); // nothing sent until a choice

  await ask.getByRole('button', { name: 'Draw main paths' }).click();
  await expect(ask).toHaveCount(0);
  await expect(panel.locator('.flow-diagram svg')).toBeVisible({ timeout: 20_000 });
  expect(lastUserText(messageCalls(await providerCalls(panel))[0]?.body)).toContain('<response_contract mode="draw" variant="business">');

  await panel.getByRole('button', { name: 'Actions' }).click();
  await panel.getByRole('menuitem', { name: 'Draw every element' }).click();
  await ask.getByRole('button', { name: 'Draw every element' }).click();
  await expect(ask).toHaveCount(0);
  await expect.poll(async () => messageCalls(await providerCalls(panel)).length).toBe(2);
  expect(lastUserText(messageCalls(await providerCalls(panel))[1]?.body)).toContain('<response_contract mode="draw" variant="admins">');
  // Every element is not a simplified picture, and its footer does not say so.
  await expect(panel.getByText(/^Drawn by Anthropic from the saved version/)).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText(/A simplified picture/)).toHaveCount(1); // the main-paths picture's, above
});

const DIAGRAM_TOO_BIG = 'Too big to read here. Open it in Excalidraw to zoom in.';

test('a picture too wide to read opens on its middle and scrolls sideways; one far wider shows whole, with a line pointing to Excalidraw', async ({ context, extensionId, serviceWorker }) => {
  const row = (n: number, label: (i: number) => string) => Array.from({ length: n }, (_, i) => `  S${i}["${label(i)}"] --> T["Create the case"]`).join('\n');
  const wide = `\`\`\`mermaid\nflowchart TD\n${row(4, (i) => `Set the defaults for region ${i + 1}`)}\n\`\`\`\n\nFour alike steps lead into one.`;
  const huge = `\`\`\`mermaid\nflowchart TD\n${row(30, (i) => `Set the defaults for region ${i + 1}`)}\n\`\`\`\n\nThirty alike steps lead into one.`;
  await prepare(context);
  // The picture's sentence arrives after its fence, so the picture draws while the answer is still arriving, as a model's does.
  const [wideFence, wideTail] = wide.split('\n\n');
  await installProviderMock(context, { answers: [{ chunks: [`${wideFence}\n\n`, 'Four alike steps ', 'lead into one.'], delayMs: 400 }, { chunks: [huge], delayMs: 10 }] });
  void wideTail;
  await mockSalesforce(context);
  await seedReadyKey(serviceWorker);
  const { panel } = await openFlow(context, extensionId);
  await panel.setViewportSize({ width: 400, height: 520 }); // a side panel's width, short enough that the answer scrolls

  await panel.getByRole('button', { name: /^Draw this flow/ }).click();
  const first = panel.locator('.flow-diagram').first();
  await expect(first).toHaveAttribute('data-fit', 'scrolls', { timeout: 20_000 });
  const scroll = await first.evaluate((el) => ({ left: el.scrollLeft, max: el.scrollWidth - el.clientWidth }));
  expect(scroll.max).toBeGreaterThan(0);
  expect(Math.abs(scroll.left - scroll.max / 2)).toBeLessThanOrEqual(1); // opens on the middle, not a corner
  await expect(first).toHaveAttribute('data-edge', 'middle');
  await expect(panel.getByText(DIAGRAM_TOO_BIG)).toHaveCount(0);
  // The picture takes its readable height after the answer's last scroll; the reader stays at the bottom, with
  // Open in Excalidraw in sight.
  await expect(panel.getByRole('button', { name: 'Open in Excalidraw' })).toBeInViewport();
  await expect.poll(() => panel.getByRole('log').evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2);

  await panel.getByLabel('Message').fill('Draw it with every region');
  await panel.getByLabel('Message').press('Enter');
  const second = panel.locator('.flow-diagram').nth(1);
  await expect(second).toHaveAttribute('data-fit', 'tooBig', { timeout: 20_000 });
  await expect(panel.getByText(DIAGRAM_TOO_BIG)).toBeVisible();
  expect(await second.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0); // whole, never a corner
});
