import type { BrowserContext, Locator, Page } from '@playwright/test';

import { expect, test } from './extension.fixture';
import { installProviderMock, messageCalls, type ProviderMockConfig, providerCalls } from './provider-mock';
import { CHAT_KEY, FLOW_A, FLOW_A_LABEL, mockSalesforce, readStorage, seedReadyKey, seedStorage } from './salesforce.mock';

// The step-7 end-to-end check, in a real Chromium: paste a key
// and chat against a paced SSE mock; a 12-message transcript keeps the composer
// visible at 320px; Enter during streaming is ignored; Stop keeps the partial;
// a Settings round-trip keeps the transcript; a Document answer keeps streaming
// through a tab switch and the returning panel picks it up and finishes it.

// Short enough to stay under the PII scanner's provider-key rule (24+ character body), long enough to look like one.
const PASTED_KEY = 'sk-ant-e2e-synthetic-key';

interface Panel {
  panel: Page;
  flowTab: Page;
  title: Locator;
  message: Locator;
}

/** Opens the panel as a tab, then a Flow Builder tab in front of it, and waits for the flow to load. */
async function openPanelOnFlow(context: BrowserContext, extensionId: string, viewport?: { width: number; height: number }): Promise<Panel> {
  const panel = await context.newPage();
  if (viewport) await panel.setViewportSize(viewport);
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const flowTab = await context.newPage();
  await flowTab.goto(FLOW_A);
  await flowTab.bringToFront();
  const title = panel.getByRole('heading', { level: 1 });
  await expect(title).toHaveText(FLOW_A_LABEL);
  return { panel, flowTab, title, message: panel.getByLabel('Message') };
}

async function expectInViewport(locator: Locator, viewport: { width: number; height: number }) {
  const box = await locator.boundingBox();
  expect(box, 'element has a box').not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
}

const words = (n: number, word: string) => Array.from({ length: n }, (_, i) => `${word}${i + 1} `);

test('first run: paste a key, start chatting, and stream an answer about the open flow', async ({ context, extensionId, serviceWorker }) => {
  await installProviderMock(context, { answers: [{ chunks: ['This flow ', 'routes **Account** ', 'updates by ', 'customer type.'], delayMs: 40 }] });
  await mockSalesforce(context);

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Set up your AI');
  await panel.getByRole('button', { name: 'Set up your AI' }).click();
  await panel.getByRole('button', { name: 'Anthropic · Claude models' }).click();

  // Validation happens on paste (a real ClipboardEvent), never per keystroke.
  const keyField = panel.getByLabel('Anthropic API key');
  await keyField.evaluate((el, key) => {
    const data = new DataTransfer();
    data.setData('text', key);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, PASTED_KEY);
  await expect(panel.getByRole('status').filter({ hasText: 'Key accepted' })).toBeVisible();
  await expect(panel.getByText(/doesn’t look like/)).toHaveCount(0);
  await panel.getByRole('button', { name: 'Start chatting' }).click();

  // The key went to chrome.storage.local (remember is on by default) and nowhere the user can see.
  expect(await readStorage(serviceWorker, 'apiKey:anthropic')).toBe(PASTED_KEY);
  expect(await panel.locator('body').innerText()).not.toContain(PASTED_KEY);

  const flowTab = await context.newPage();
  await flowTab.goto(FLOW_A);
  await flowTab.bringToFront();
  await expect(panel.getByRole('heading', { level: 1 })).toHaveText(FLOW_A_LABEL);
  await expect(panel.getByText('Ready. Ask anything about this flow.')).toBeVisible();
  await expect(panel.getByRole('button', { name: `About this flow: ${FLOW_A_LABEL}` })).toBeVisible(); // the gauge, named after the flow
  await expect(panel.getByText(FLOW_A_LABEL)).toHaveCount(1); // the header; the message box no longer repeats the name

  const message = panel.getByLabel('Message');
  await message.fill('What does this flow do?');
  await message.press('Enter');
  await expect(panel.getByText('What does this flow do?')).toBeVisible();
  await expect(panel.getByRole('log')).toContainText('routes Account updates by customer type.');
  await expect(panel.getByRole('button', { name: 'Copy answer' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Send' })).toBeVisible();

  const calls = await providerCalls(panel);
  const [sent] = messageCalls(calls);
  expect(messageCalls(calls)).toHaveLength(1);
  expect(sent?.apiKey).toBe(PASTED_KEY);
  expect(sent?.browserAccess).toBe('true');
  const body = sent?.body as { model: string; max_tokens: number; stream: boolean; cache_control: unknown; messages: { role: string; content: { type: string; text: string }[] }[] };
  expect(body.model).toBe('claude-sonnet-5');
  expect(body.stream).toBe(true);
  expect(body.max_tokens).toBe(16_000);
  expect(body.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  expect(body.messages[0]?.content[0]?.text).toContain('<flow_metadata_json>');
  expect(body.messages[0]?.content[1]?.text).toBe('What does this flow do?');
  // The key never rides in a URL.
  expect(calls.every((c) => !c.url.includes(PASTED_KEY))).toBe(true);

  const stored = (await readStorage(serviceWorker, CHAT_KEY)) as { turns: { role: string; displayText: string; interrupted?: string }[] };
  expect(stored.turns.map((t) => [t.role, t.interrupted ?? null])).toEqual([
    ['user', null],
    ['assistant', null],
  ]);
});

test('a 12-message transcript keeps the composer fully visible at 320px', async ({ context, extensionId, serviceWorker }) => {
  await installProviderMock(context, { answers: [{ chunks: ['x'], delayMs: 10 }] });
  await mockSalesforce(context);
  await seedReadyKey(serviceWorker);
  const turns = [];
  for (let i = 1; i <= 6; i++) {
    turns.push({ role: 'user', displayText: `Question ${i}`, sentText: `Question ${i}`, mode: 'ask', timestamp: i * 2 });
    turns.push({
      role: 'assistant',
      displayText: `## Answer ${i}\n\nThe flow routes **Account** updates by customer type and writes a follow-up task.\n\n- Enterprise accounts go to \`UpdateAccount\`\n- SMB accounts go to \`AssignFollowupOwner\`\n\n\`\`\`\nAND({!$Record.AnnualRevenue} > 1000000, {!AccountAgeInDays} > 365)\n\`\`\``,
      stopReason: 'end',
      timestamp: i * 2 + 1,
    });
  }
  await seedStorage(serviceWorker, { [CHAT_KEY]: { key: CHAT_KEY, turns, updatedAt: 100 } });

  const viewport = { width: 320, height: 600 };
  const { panel, message } = await openPanelOnFlow(context, extensionId, viewport);
  await expect(panel.getByText('Question 6')).toBeVisible();
  expect(await panel.getByRole('log').getByText(/^Question \d$/).count()).toBe(6);

  await expectInViewport(message, viewport);
  await expectInViewport(panel.getByRole('button', { name: 'Send' }), viewport);
  await expectInViewport(panel.getByRole('button', { name: 'Quick actions' }), viewport);
  // The transcript scrolled to the latest answer, and nothing forces the page wider than the panel.
  await expectInViewport(panel.getByText('Question 6'), viewport);
  expect(await panel.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  // The formula's code block scrolls inside itself rather than widening the answer.
  const pre = panel.locator('.answer pre').last();
  expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).overflowX === 'auto')).toBe(true);
});

test('Enter during streaming is ignored; Stop keeps the partial answer labelled Stopped, with no Retry', async ({ context, extensionId, serviceWorker }) => {
  await installProviderMock(context, { answers: [{ chunks: words(40, 'word'), delayMs: 100 }] });
  await mockSalesforce(context);
  await seedReadyKey(serviceWorker);
  const { panel, message } = await openPanelOnFlow(context, extensionId);

  await message.fill('First question');
  await message.press('Enter');
  await expect(panel.getByRole('button', { name: 'Stop' })).toBeVisible();
  await panel.getByRole('button', { name: 'Stop' }).hover();
  await expect(panel.getByRole('tooltip')).toHaveText('Stop. Keeps what has arrived so far.', { timeout: 3_000 });
  await expect(panel.getByRole('log')).toContainText('word3');

  // The busy guard: a second Enter neither sends nor clears the draft.
  await message.fill('Second while streaming');
  await message.press('Enter');
  await panel.waitForTimeout(300);
  expect(await message.inputValue()).toBe('Second while streaming');
  expect(messageCalls(await providerCalls(panel))).toHaveLength(1);
  expect(await panel.getByRole('log').getByText(/question|streaming/).count()).toBe(1);

  await panel.getByRole('button', { name: 'Stop' }).click();
  await expect(panel.getByRole('button', { name: 'Send' })).toBeVisible();
  await expect(panel.getByText('Stopped')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  const partial = await panel.locator('.answer').innerText();
  expect(partial).toMatch(/^word1 word2/);
  expect(partial).not.toContain('word40');
  // Nothing arrived after Stop.
  await panel.waitForTimeout(400);
  expect(await panel.locator('.answer').innerText()).toBe(partial);
  expect(messageCalls(await providerCalls(panel))).toHaveLength(1);

  const stored = (await readStorage(serviceWorker, CHAT_KEY)) as { turns: { role: string; displayText: string; interrupted?: string }[] };
  expect(stored.turns[1]).toMatchObject({ role: 'assistant', interrupted: 'stopped' });
  expect(stored.turns[1]?.displayText.trim()).toBe(partial.trim());
});

test('a Settings round-trip keeps the transcript', async ({ context, extensionId, serviceWorker }) => {
  await installProviderMock(context, { answers: [{ chunks: ['It assigns ', 'an owner.'], delayMs: 20 }] });
  await mockSalesforce(context);
  await seedReadyKey(serviceWorker);
  const { panel, message } = await openPanelOnFlow(context, extensionId);

  await message.fill('Who owns the record afterwards?');
  await message.press('Enter');
  await expect(panel.getByRole('log')).toContainText('It assigns an owner.');
  await expect(panel.getByRole('button', { name: 'Send' })).toBeVisible();

  await panel.getByRole('button', { name: 'More' }).click();
  await panel.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(panel.getByRole('heading', { level: 1 })).toHaveText('Settings');
  await expect(panel.getByText('Anthropic · Claude models')).toBeVisible();
  await panel.getByRole('button', { name: 'Back' }).click();

  await expect(panel.getByRole('heading', { level: 1 })).toHaveText(FLOW_A_LABEL);
  await expect(panel.getByText('Who owns the record afterwards?')).toBeVisible();
  await expect(panel.getByRole('log')).toContainText('It assigns an owner.');
  expect(messageCalls(await providerCalls(panel))).toHaveLength(1);
});

test('a Document answer keeps streaming while the panel shows another tab; the returning panel picks it up and finishes it', async ({ context, extensionId, serviceWorker }) => {
  const config: ProviderMockConfig = { answers: [{ chunks: words(40, 'section'), delayMs: 100 }] };
  await installProviderMock(context, config);
  const toolingCalls = await mockSalesforce(context);
  await seedReadyKey(serviceWorker);
  const { panel, flowTab, title } = await openPanelOnFlow(context, extensionId);
  expect(toolingCalls).toHaveLength(2);

  await panel.getByRole('button', { name: 'Document this flow' }).click();
  await expect(panel.getByRole('log')).toContainText('section3');

  // Look at another tab mid-answer, then come back. The answer keeps going meanwhile.
  const other = await context.newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  await expect(panel.locator('main p').first()).toHaveText(/Open a Salesforce org/);
  await other.waitForTimeout(600);
  await flowTab.bringToFront();
  await expect(title).toHaveText(FLOW_A_LABEL);
  expect(toolingCalls).toHaveLength(4);

  await expect(panel.getByText('Document', { exact: true })).toBeVisible(); // the quick-action pill
  await expect(panel.getByRole('button', { name: 'Stop' })).toBeVisible(); // still streaming, and stoppable
  await expect(panel.getByRole('log')).toContainText('section9');
  await expect(panel.getByText('Interrupted')).toHaveCount(0);
  await expect(panel.getByRole('log')).toContainText('section40', { timeout: 10_000 });
  await expect(panel.getByRole('button', { name: 'Send' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Copy', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Download' })).toBeVisible();
  await expect(panel.getByText('Interrupted')).toHaveCount(0);
  expect(messageCalls(await providerCalls(panel))).toHaveLength(1);
  const stored = (await readStorage(serviceWorker, CHAT_KEY)) as { turns: { role: string; stopReason?: string; interrupted?: string }[] };
  expect(stored.turns[1]).toMatchObject({ role: 'assistant', stopReason: 'end' });
  expect(stored.turns[1]?.interrupted).toBeUndefined();
});
