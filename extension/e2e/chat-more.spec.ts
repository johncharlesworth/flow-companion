import { expect, test } from './extension.fixture';
import { installProviderMock, messageCalls, providerCalls } from './provider-mock';
import { CHAT_KEY, FLOW_A, FLOW_A_LABEL, mockSalesforce, READY_SETTINGS, readStorage, SEEDED_KEY, seedReadyKey, seedStorage } from './salesforce.mock';

// The rest of the chat surface in a real Chromium: Explain an element through
// the picker, switching models from the composer, the hard stop before a send,
// and turning "remember" off.

declare const chrome: {
  storage: { session: { get(keys: string): Promise<Record<string, unknown>> } };
};

async function openFlow(context: Parameters<typeof mockSalesforce>[0], extensionId: string) {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const flowTab = await context.newPage();
  await flowTab.goto(FLOW_A);
  await flowTab.bringToFront();
  await expect(panel.getByRole('heading', { level: 1 })).toHaveText(FLOW_A_LABEL);
  return panel;
}

test('Explain an element: the picker attaches a chip, Enter sends the element as a focus block, the bubble shows the pill and chip', async ({ context, extensionId, serviceWorker }) => {
  await installProviderMock(context, { answers: [{ chunks: ['**CheckCustomerType** is a Decision ', 'with two outcomes.'], delayMs: 20 }] });
  await mockSalesforce(context);
  await seedReadyKey(serviceWorker);
  const panel = await openFlow(context, extensionId);

  await panel.getByRole('button', { name: 'Explain an element' }).click();
  const search = panel.getByLabel('Search elements');
  await expect(search).toBeFocused();
  await search.press('Escape'); // Escape leaves the picker with nothing attached
  await expect(search).toHaveCount(0);
  await expect(panel.getByLabel('Message')).toBeEnabled();
  await panel.getByRole('button', { name: 'Explain an element' }).click();
  await search.fill('customer');
  await panel.getByRole('option', { name: /CheckCustomerType/ }).click();

  const message = panel.getByLabel('Message');
  await expect(message).toHaveAttribute('placeholder', 'Press Enter to explain CheckCustomerType, or ask something about it');
  await expect(panel.getByRole('button', { name: 'Remove CheckCustomerType' })).toBeVisible();
  await message.press('Enter');

  await expect(panel.getByRole('log')).toContainText('with two outcomes.');
  const log = panel.getByRole('log');
  await expect(log.getByText('Explain', { exact: true })).toBeVisible(); // the quick-action pill
  await expect(log.getByText('CheckCustomerType', { exact: true }).first()).toBeVisible(); // the element chip in the bubble
  await expect(panel.getByRole('button', { name: 'Remove CheckCustomerType' })).toHaveCount(0); // the composer chip is spent

  const [sent] = messageCalls(await providerCalls(panel));
  const body = sent?.body as { messages: { content: { text: string }[] }[] };
  const turn = body.messages[0]?.content[1]?.text ?? '';
  expect(turn).toContain('<response_contract mode="explain">');
  expect(turn).toContain('<focus_element name="CheckCustomerType">');
  expect(turn).toContain('<user_question>\nExplain CheckCustomerType.\n</user_question>');
});

test('the quick-actions button in the composer offers the three actions and a starter question; Overview sends its contract', async ({ context, extensionId, serviceWorker }) => {
  await installProviderMock(context, { answers: [{ chunks: ['## Purpose\n\nRoutes accounts.'], delayMs: 10 }] });
  await mockSalesforce(context);
  await seedReadyKey(serviceWorker);
  const panel = await openFlow(context, extensionId);

  await panel.getByRole('button', { name: 'Quick actions' }).click();
  for (const label of ['Overview', 'Explain an element', 'Document this flow', 'Draw this flow', 'Draw one element…', 'Walk me through the main logic', 'What would you simplify, and why?', 'Where could this flow go wrong?', 'What should someone know before changing this flow?']) {
    await expect(panel.getByRole('menuitem', { name: label })).toBeVisible();
  }
  await panel.getByRole('menuitem', { name: 'Overview' }).click();
  await expect(panel.getByRole('log')).toContainText('Routes accounts.');
  await expect(panel.getByRole('log').getByText('Overview', { exact: true })).toBeVisible(); // the pill on the compact user bubble
  const [sent] = messageCalls(await providerCalls(panel));
  const body = sent?.body as { messages: { content: { text: string }[] }[] };
  expect(body.messages[0]?.content[1]?.text).toContain('<response_contract mode="overview">');
});

test('the empty transcript offers the starter questions under a collapsed row; one click asks it', async ({ context, extensionId, serviceWorker }) => {
  await installProviderMock(context, { answers: [{ chunks: ['Nothing to simplify.'], delayMs: 10 }] });
  await mockSalesforce(context);
  await seedReadyKey(serviceWorker);
  const panel = await openFlow(context, extensionId);

  await expect(panel.getByRole('button', { name: 'What would you simplify, and why?' })).toHaveCount(0); // collapsed
  await panel.getByRole('button', { name: 'Questions to try' }).click();
  await panel.getByRole('button', { name: 'What would you simplify, and why?' }).click();
  await expect(panel.getByRole('log')).toContainText('What would you simplify, and why?'); // asked as the user's own words
  await expect(panel.getByRole('log')).toContainText('Nothing to simplify.');
  const [sent] = messageCalls(await providerCalls(panel));
  expect((sent?.body as { messages: { content: { text: string }[] }[] }).messages[0]?.content[1]?.text).toBe('What would you simplify, and why?');
});

test('the resize tip shows on a narrow panel only, and retires after the first message ever sent', async ({ context, extensionId, serviceWorker }) => {
  await installProviderMock(context, { answers: [{ chunks: ['ok'], delayMs: 10 }] });
  await mockSalesforce(context);
  await seedReadyKey(serviceWorker);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 320, height: 600 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const flowTab = await context.newPage();
  await flowTab.goto(FLOW_A);
  await flowTab.bringToFront();
  await expect(panel.getByRole('heading', { level: 1 })).toHaveText(FLOW_A_LABEL);

  const tip = panel.getByText('Tip: drag the panel’s left edge to make it wider.');
  await expect(tip).toBeVisible();
  await panel.setViewportSize({ width: 600, height: 600 });
  await expect(tip).toBeHidden(); // the user has found the edge
  await panel.setViewportSize({ width: 320, height: 600 });
  await expect(tip).toBeVisible();

  await panel.getByLabel('Message').fill('Hi');
  await panel.getByLabel('Message').press('Enter');
  await expect(panel.getByRole('log')).toContainText('ok');
  await panel.getByRole('button', { name: 'New chat' }).click();
  await panel.getByRole('alertdialog').getByRole('button', { name: 'New chat' }).click();
  await expect(panel.getByText('Ready. Ask anything about this flow.')).toBeVisible();
  await expect(tip).toHaveCount(0); // retired for good
  expect(((await readStorage(serviceWorker, 'settings')) as { resizeTipDone: boolean }).resizeTipDone).toBe(true);
});

test('New chat asks first when the chat has messages; Keep leaves it alone, New chat clears it', async ({ context, extensionId, serviceWorker }) => {
  await installProviderMock(context, { answers: [{ chunks: ['kept'], delayMs: 10 }] });
  await mockSalesforce(context);
  await seedReadyKey(serviceWorker);
  const panel = await openFlow(context, extensionId);

  await panel.getByRole('button', { name: 'New chat' }).click(); // empty chat: nothing to confirm
  await expect(panel.getByRole('alertdialog')).toHaveCount(0);

  await panel.getByLabel('Message').fill('Hello');
  await panel.getByLabel('Message').press('Enter');
  await expect(panel.getByRole('log')).toContainText('kept');
  await panel.getByRole('button', { name: 'New chat' }).click();
  const confirm = panel.getByRole('alertdialog');
  await expect(confirm).toContainText('Start a new chat? This conversation will be cleared.');
  await confirm.getByRole('button', { name: 'Keep' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(panel.getByRole('log')).toContainText('kept');

  await panel.getByRole('button', { name: 'New chat' }).click();
  await panel.getByRole('alertdialog').getByRole('button', { name: 'New chat' }).click();
  await expect(panel.getByText('Ready. Ask anything about this flow.')).toBeVisible();
  expect(await readStorage(serviceWorker, CHAT_KEY)).toBeUndefined();
});

test('switching models from the composer posts a notice and the next request names the new model', async ({ context, extensionId, serviceWorker }) => {
  await installProviderMock(context, { answers: [{ chunks: ['ok'], delayMs: 10 }] });
  await mockSalesforce(context);
  await seedReadyKey(serviceWorker);
  const panel = await openFlow(context, extensionId);

  await panel.getByRole('button', { name: 'Claude Sonnet 5' }).click();
  await expect(panel.getByText('Switching models re-sends the whole flow once.')).toBeVisible();
  await panel.getByRole('menuitem', { name: /Claude Haiku 4\.5/ }).click();
  await expect(panel.getByRole('button', { name: 'Claude Haiku 4.5' })).toBeVisible();

  await panel.getByLabel('Message').fill('Hi');
  await panel.getByLabel('Message').press('Enter');
  await expect(panel.getByRole('log')).toContainText('Switched to Claude Haiku 4.5');
  await expect(panel.getByRole('log')).toContainText('ok');
  const [sent] = messageCalls(await providerCalls(panel));
  expect((sent?.body as { model: string }).model).toMatch(/^claude-haiku-4-5/);
});

test('a flow too big for the chosen model disables Send with the notice, and one click switches to a model that fits', async ({ context, extensionId, serviceWorker }) => {
  await installProviderMock(context, { answers: [{ chunks: ['fits'], delayMs: 10 }], flowTokens: 250_000 });
  await mockSalesforce(context);
  await seedStorage(serviceWorker, {
    settings: { ...READY_SETTINGS, modelByProvider: { ...READY_SETTINGS.modelByProvider, anthropic: 'claude-haiku-4-5-20251001' } },
    'apiKey:anthropic': SEEDED_KEY,
  });
  const panel = await openFlow(context, extensionId);

  await expect(panel.getByRole('status').filter({ hasText: 'This flow is too big for Claude Haiku 4.5. Claude Sonnet 5 can read it.' })).toBeVisible();
  const message = panel.getByLabel('Message');
  await message.fill('What does this flow do?');
  await expect(panel.getByRole('button', { name: 'Send' })).toBeDisabled();
  await message.press('Enter');
  expect(messageCalls(await providerCalls(panel))).toHaveLength(0);

  await panel.getByRole('button', { name: 'Switch to Claude Sonnet 5' }).click();
  await expect(panel.getByText(/too big for/)).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Claude Sonnet 5' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Send' })).toBeEnabled();
  expect(await message.inputValue()).toBe('What does this flow do?'); // the draft survived
  await message.press('Enter');
  await expect(panel.getByRole('log')).toContainText('fits');
  const [sent] = messageCalls(await providerCalls(panel));
  expect((sent?.body as { model: string }).model).toBe('claude-sonnet-5');
});

test('turning "remember" off moves the key to session storage and keeps the panel ready', async ({ context, extensionId, serviceWorker }) => {
  await installProviderMock(context, { answers: [{ chunks: ['ok'], delayMs: 10 }] });
  await mockSalesforce(context);
  await seedReadyKey(serviceWorker);
  const panel = await openFlow(context, extensionId);

  await panel.getByRole('button', { name: 'More' }).click();
  await panel.getByRole('menuitem', { name: 'Settings' }).click();
  await panel.getByRole('button', { name: 'Anthropic · Claude models' }).click();
  const remember = panel.getByRole('checkbox', { name: /Remember this key on this computer/ });
  await expect(remember).toBeChecked();
  await remember.click();
  await expect(remember).not.toBeChecked();

  await expect.poll(() => readStorage(serviceWorker, 'apiKey:anthropic')).toBeUndefined();
  const inSession = await serviceWorker.evaluate(async () => (await chrome.storage.session.get('apiKey:anthropic'))['apiKey:anthropic']);
  expect(inSession).toBe(SEEDED_KEY);

  await panel.getByRole('button', { name: 'Back' }).click();
  await expect(panel.getByRole('heading', { level: 1 })).toHaveText(FLOW_A_LABEL);
  await panel.getByLabel('Message').fill('Still works?');
  await panel.getByLabel('Message').press('Enter');
  await expect(panel.getByRole('log')).toContainText('ok');
  expect(messageCalls(await providerCalls(panel))[0]?.apiKey).toBe(SEEDED_KEY);
});
