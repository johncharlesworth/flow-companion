import type { Locator } from '@playwright/test';

import { expect, test } from './extension.fixture';
import { installProviderMock, messageCalls, providerCalls } from './provider-mock';
import { API_HOST, CHAT_KEY, DEFINITION_ID, FLOW_A, FLOW_A_LABEL, mockSalesforce, READY_SETTINGS, readStorage, SEEDED_KEY, seedReadyKey, seedStorage, syntheticFlow, VERSION_ID } from './salesforce.mock';

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

test('Explain an element: a pick sends at once, with the element as a focus block; the bubble shows the pill and the name', async ({ context, extensionId, serviceWorker }) => {
  await installProviderMock(context, { answers: [{ chunks: ['**CheckCustomerType** is a Decision ', 'with two outcomes.'], delayMs: 20 }] });
  await mockSalesforce(context);
  await seedReadyKey(serviceWorker);
  const panel = await openFlow(context, extensionId);

  await panel.getByRole('button', { name: 'Explain an element' }).click();
  const search = panel.getByLabel('Search elements');
  await expect(search).toBeFocused();
  await search.press('Escape'); // Escape leaves the picker with nothing sent, and focus in the message box
  await expect(search).toHaveCount(0);
  await expect(panel.getByLabel('Message')).toBeEnabled();
  await expect(panel.getByLabel('Message')).toBeFocused();
  await panel.getByRole('button', { name: 'Explain an element' }).click();
  await search.fill('customer');
  await panel.getByRole('option', { name: /CheckCustomerType/ }).click();

  // The pick sends: no chip on the message box, no Enter to press, and focus back in the box.
  const message = panel.getByLabel('Message');
  await expect(panel.getByRole('log')).toContainText('with two outcomes.');
  await expect(message).toHaveAttribute('placeholder', 'Ask about this flow…');
  await expect(panel.getByRole('button', { name: /^Remove / })).toHaveCount(0);
  await expect(message).toBeFocused();
  const log = panel.getByRole('log');
  await expect(log.getByText('Explain', { exact: true })).toBeVisible(); // the quick-action pill
  await expect(log.getByText('CheckCustomerType', { exact: true }).first()).toBeVisible(); // the element's name in the bubble

  const [sent] = messageCalls(await providerCalls(panel));
  const body = sent?.body as { messages: { content: { text: string }[] }[] };
  const turn = body.messages[0]?.content[1]?.text ?? '';
  expect(turn).toContain('<response_contract mode="explain">');
  expect(turn).toContain('<focus_element name="CheckCustomerType">');
  expect(turn).toContain('<user_question>\nExplain CheckCustomerType.\n</user_question>');
});

test('the Actions chip in the composer offers the four actions with the three pictures, and no starter questions; Overview sends its contract', async ({ context, extensionId, serviceWorker }) => {
  await installProviderMock(context, { answers: [{ chunks: ['## Purpose\n\nRoutes accounts.'], delayMs: 10 }] });
  await mockSalesforce(context);
  await seedReadyKey(serviceWorker);
  const panel = await openFlow(context, extensionId);

  await panel.getByRole('button', { name: 'Actions' }).click();
  for (const label of ['Overview', 'Draw main paths', 'Draw one element', 'Draw every element', 'Document this flow', 'Explain an element']) {
    await expect(panel.getByRole('menuitem', { name: label })).toBeVisible();
  }
  await expect(panel.getByRole('menuitem', { name: 'Walk me through the main logic' })).toHaveCount(0);
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
  const list = panel.getByRole('button', { name: 'Questions to try' }).locator('xpath=following-sibling::ul[1]');
  await expect(list.getByRole('button')).toHaveText(['Walk me through the main logic', 'Explain this flow to a non-technical CEO', 'What would you simplify, and why?', 'What would you improve about this flow?', 'Where could this flow go wrong?', 'What should someone know before changing this flow?']);
  await panel.getByRole('button', { name: 'What would you simplify, and why?' }).click();
  await expect(panel.getByRole('log')).toContainText('What would you simplify, and why?'); // asked as the user's own words
  await expect(panel.getByRole('log')).toContainText('Nothing to simplify.');
  const [sent] = messageCalls(await providerCalls(panel));
  expect((sent?.body as { messages: { content: { text: string }[] }[] }).messages[0]?.content[1]?.text).toBe('What would you simplify, and why?');
});

test('the resize tip shows on every empty screen, at any width, and again after New chat', async ({ context, extensionId, serviceWorker }) => {
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

  // On every empty screen, whatever the width, and gone once the first message is sent.
  const tip = panel.getByText('Tip: drag the panel’s left edge to make it wider.');
  await expect(tip).toBeVisible();
  await panel.setViewportSize({ width: 600, height: 600 });
  await expect(tip).toBeVisible();

  await panel.getByLabel('Message').fill('Hi');
  await panel.getByLabel('Message').press('Enter');
  await expect(panel.getByRole('log')).toContainText('ok');
  await expect(tip).toHaveCount(0); // the empty screen's, gone with it
  await panel.getByRole('button', { name: 'New chat' }).click();
  await panel.getByRole('alertdialog').getByRole('button', { name: 'New chat' }).click();
  await expect(panel.getByText('Ask anything about this flow.')).toBeVisible();
  await expect(tip).toBeVisible(); // back on the next empty screen
});

test('New chat asks first, right under the header, when the chat has messages; Keep leaves it alone, New chat clears it', async ({ context, extensionId, serviceWorker }) => {
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
  // Right under the header, beside the icon that asked: above the message box it would sit about 520px
  // from the icon, easy to miss in a full-height window. The conversation starts below it.
  const confirmBox = (await confirm.boundingBox())!;
  const iconBox = (await panel.getByRole('button', { name: 'New chat' }).first().boundingBox())!;
  expect(confirmBox.y - (iconBox.y + iconBox.height)).toBeLessThan(12);
  expect((await panel.getByRole('log').boundingBox())!.y).toBeGreaterThanOrEqual(confirmBox.y + confirmBox.height);
  // It is outlined with the hairline border.
  await expect(confirm).toHaveClass(/border-hairline/);
  // At 320px the buttons drop below the sentence rather than squeeze it into a column.
  await panel.setViewportSize({ width: 320, height: 720 });
  await expectButtonsBelow(confirm, 2);
  // At 400 the pair still wraps as one: never New chat beside the sentence and Keep alone below it.
  await panel.setViewportSize({ width: 400, height: 720 });
  await expectButtonsBelow(confirm, 1);
  await panel.setViewportSize({ width: 1280, height: 720 });
  await confirm.getByRole('button', { name: 'Keep' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(panel.getByRole('log')).toContainText('kept');

  await panel.getByRole('button', { name: 'New chat' }).click();
  await panel.getByRole('alertdialog').getByRole('button', { name: 'New chat' }).click();
  await expect(panel.getByText('Ask anything about this flow.')).toBeVisible();
  expect(await readStorage(serviceWorker, CHAT_KEY)).toBeUndefined();
  // The empty screen ends in the transcript's fade, right on the message box, so an
  // overflowing first screen is not sliced on the box's edge.
  const emptyFade = panel.locator('div.bg-gradient-to-t');
  await expect(emptyFade).toHaveCount(1);
  const [fade, box] = [await emptyFade.boundingBox(), await panel.getByLabel('Message').locator('..').boundingBox()];
  expect(fade!.y + fade!.height).toBeCloseTo(box!.y, 0);
  // On a short window the screen overflows; scrolled to the end, its last line clears the fade.
  await panel.setViewportSize({ width: 320, height: 480 });
  await panel.getByText('Ask anything about this flow.').evaluate((el) => {
    const scroller = el.closest('.overflow-y-auto')!;
    scroller.scrollTop = scroller.scrollHeight;
  });
  const hint = panel.getByText('Pick one to see it explained.');
  const [lastLine, shortFade] = [await hint.boundingBox(), await emptyFade.boundingBox()];
  expect(lastLine!.y + lastLine!.height).toBeLessThanOrEqual(shortFade!.y + 1);
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

  const notice = panel.getByRole('status').filter({ hasText: 'This flow is too big for Claude Haiku 4.5. Claude Sonnet 5 can read it.' });
  await expect(notice).toBeVisible();
  await panel.setViewportSize({ width: 400, height: 720 });
  await expectButtonsBelow(notice, 2);
  const message = panel.getByLabel('Message');
  // 7px between the message and the notice, and the toolbar's 14px under it.
  const [textBox, noticeBox, sendBox] = [await message.boundingBox(), await notice.boundingBox(), await panel.getByRole('button', { name: 'Send' }).boundingBox()];
  expect(noticeBox!.y - (textBox!.y + textBox!.height)).toBeCloseTo(7, 0);
  expect(sendBox!.y - (noticeBox!.y + noticeBox!.height)).toBeCloseTo(14, 0);
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

test('the long-chat nudge keeps its sentence whole and drops its buttons below it on a narrow panel', async ({ context, extensionId, serviceWorker }) => {
  // 900,000 of Sonnet 5's million tokens: past the point where the nudge appears.
  await installProviderMock(context, { answers: [{ chunks: ['long'], delayMs: 10, inputTokens: 900_000 }] });
  await mockSalesforce(context);
  await seedReadyKey(serviceWorker);
  const panel = await openFlow(context, extensionId);
  await panel.setViewportSize({ width: 320, height: 720 });
  await panel.getByLabel('Message').fill('Hi');
  await panel.getByLabel('Message').press('Enter');
  const nudge = panel.getByRole('status').filter({ hasText: 'This chat is getting long.' });
  await expect(nudge).toBeVisible();
  // Three lines at 320px, rather than eight squeezed beside the buttons.
  await expectButtonsBelow(nudge, 3);
  await panel.setViewportSize({ width: 400, height: 720 });
  await expectButtonsBelow(nudge, 2);
});

/** Every button sits on one line under the sentence (never split across lines), and the sentence takes no more than `lines` lines. */
async function expectButtonsBelow(row: Locator, lines: number) {
  const sentence = row.locator('span').first();
  const text = (await sentence.boundingBox())!;
  const tops = await row.getByRole('button').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
  for (const top of tops) expect(top).toBeGreaterThanOrEqual(text.y + text.height - 1);
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1);
  const lineHeight = await sentence.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  expect(Math.round(text.height / lineHeight)).toBeLessThanOrEqual(lines);
}

test('a long API name wraps inside the Outline and ends in an ellipsis in the bubble: the panel never scrolls sideways at 320px', async ({ context, extensionId, serviceWorker }) => {
  // Salesforce allows 80 characters, and Flow Builder makes the API name from the label.
  const LONG = 'Assign_Followup_Owner_By_Region_And_Account_Tier_For_Renewals';
  const flow = structuredClone(syntheticFlow) as { assignments: { name: string; label: string }[] };
  flow.assignments.push({ ...flow.assignments[0]!, name: LONG, label: 'Assign followup owner by region and account tier for renewals' });
  await installProviderMock(context, { answers: [{ chunks: [`An assignment: **${LONG}** sets \`${LONG}\` on the record.`], delayMs: 10 }, { chunks: ['Because.'], delayMs: 10 }] });
  await mockSalesforce(context);
  // Registered after the mock, so it answers the flow request with the extra element.
  await context.route(`https://${API_HOST}/**`, (route) =>
    /\/tooling\/sobjects\/Flow\/[A-Za-z0-9]+$/.test(new URL(route.request().url()).pathname)
      ? route.fulfill({ json: { Id: VERSION_ID, VersionNumber: 4, Status: 'Draft', MasterLabel: FLOW_A_LABEL, DefinitionId: DEFINITION_ID, ProcessType: 'AutoLaunchedFlow', LastModifiedDate: '2026-09-01T10:00:00.000+0000', Metadata: flow } })
      : route.fallback(),
  );
  await seedReadyKey(serviceWorker);
  const panel = await openFlow(context, extensionId);
  await panel.setViewportSize({ width: 320, height: 760 });
  const sideways = () => panel.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  await panel.getByRole('button', { name: /^Outline/ }).click();
  await panel.getByRole('button', { name: /^Assignments/ }).click();
  const row = panel.getByRole('option', { name: new RegExp(LONG) });
  const list = panel.getByRole('listbox', { name: 'Flow elements' });
  const [rowBox, listBox] = [await row.boundingBox(), await list.boundingBox()];
  expect(rowBox!.x + rowBox!.width).toBeLessThanOrEqual(listBox!.x + listBox!.width + 0.5);
  expect(await list.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
  expect(await sideways()).toBe(0);
  await expect(row).toContainText(LONG); // wrapped, not cut: the whole name is there to tell it from its neighbours

  await row.click();
  await expect(panel.getByRole('log')).toContainText('on the record.');
  // The answer names it in bold and in code, and breaks it rather than scrolling the conversation sideways.
  expect(await panel.getByRole('log').evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
  const pill = panel.getByRole('log').locator(`span[title="${LONG}"]`); // the bubble's pill, which carries the full name on hover
  await expect(pill).toHaveText(LONG);
  expect(await pill.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true); // an ellipsis
  expect(await sideways()).toBe(0);
  // And not off the left edge either, which no scrollbar would show: the bubble stays inside the log.
  const [bubble, log] = [await pill.locator('xpath=../..').boundingBox(), await panel.getByRole('log').boundingBox()];
  expect(bubble!.x).toBeGreaterThanOrEqual(log!.x);

  // A typed question naming it wraps inside its bubble too.
  await panel.getByLabel('Message').fill(`Why does ${LONG} run twice?`);
  await panel.getByLabel('Message').press('Enter');
  const typed = panel.getByRole('log').getByText(`Why does ${LONG} run twice?`);
  await expect(typed).toBeVisible();
  const [typedBox, typedBubble] = [await typed.boundingBox(), await typed.locator('..').boundingBox()];
  expect(typedBubble!.x).toBeGreaterThanOrEqual(log!.x);
  expect(typedBox!.x + typedBox!.width).toBeLessThanOrEqual(typedBubble!.x + typedBubble!.width);
});

test('an Actions row chosen from the keyboard leaves focus in the message box while the answer arrives', async ({ context, extensionId, serviceWorker }) => {
  await installProviderMock(context, { answers: [{ chunks: Array.from({ length: 30 }, (_, i) => `word${i + 1} `), delayMs: 80 }] });
  await mockSalesforce(context);
  await seedReadyKey(serviceWorker);
  const panel = await openFlow(context, extensionId);
  const message = panel.getByLabel('Message');
  await message.focus();
  await panel.keyboard.press('Tab'); // Actions
  await expect(panel.getByRole('button', { name: 'Actions' })).toBeFocused();
  await panel.keyboard.press('Enter');
  await expect(panel.getByRole('menuitem', { name: 'Overview' })).toBeFocused();
  await panel.keyboard.press('Enter');
  await expect(panel.getByRole('log')).toContainText('word2');
  // Actions is off while the answer arrives, so focus went to the box rather than back to it (and the page).
  await expect(message).toBeFocused();
  await expect(panel.getByRole('button', { name: 'Actions' })).toBeDisabled();
});

test('at 320px, Settings keeps the default model and each provider on one line', async ({ context, extensionId, serviceWorker }) => {
  await installProviderMock(context, { answers: [{ chunks: ['ok'], delayMs: 10 }] });
  await mockSalesforce(context);
  // Anthropic's key saved while OpenAI is active: its card shows "Key saved" beside the title.
  const settings = { ...READY_SETTINGS, activeProvider: 'openai', keys: { ...READY_SETTINGS.keys, openai: { status: 'validated', last4: 'abcd', models: [{ id: 'gpt-5.6-terra', maxInputTokens: 922_000 }], checkedAt: Date.now() } } }; // checked now: no list refresh, which would reach the real OpenAI
  await seedStorage(serviceWorker, { settings, 'apiKey:anthropic': SEEDED_KEY, 'apiKey:openai': 'sk-test-abcd' });
  const panel = await openFlow(context, extensionId);
  await panel.setViewportSize({ width: 320, height: 760 });
  await panel.getByRole('button', { name: 'More' }).click();
  await panel.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(panel.getByRole('heading', { level: 1 })).toHaveText('Settings');
  // One line: no taller than a line and a half. Anthropic's title may end in an ellipsis
  // in this state (its key saved while another provider is active, at 320px).
  const oneLine = (locator: Locator) => locator.evaluate((el) => el.getBoundingClientRect().height < parseFloat(getComputedStyle(el).lineHeight) * 1.5);
  expect(await oneLine(panel.getByText('Anthropic · Claude models'))).toBe(true);
  await expect(panel.getByText('Key saved')).toBeVisible();
  expect(await oneLine(panel.getByText('GPT-5.6 Terra', { exact: true }).first())).toBe(true);
});

test('at 320px, Settings keeps "Claude Sonnet 5" whole after "Default model:"', async ({ context, extensionId, serviceWorker }) => {
  await installProviderMock(context, { answers: [{ chunks: ['ok'], delayMs: 10 }] });
  await mockSalesforce(context);
  await seedReadyKey(serviceWorker);
  const panel = await openFlow(context, extensionId);
  await panel.setViewportSize({ width: 320, height: 760 });
  await panel.getByRole('button', { name: 'More' }).click();
  await panel.getByRole('menuitem', { name: 'Settings' }).click();
  // The name must not break before its last word and leave "5" alone on the next line.
  const name = panel.getByText('Claude Sonnet 5', { exact: true }).first();
  expect(await name.evaluate((el) => el.getClientRects().length)).toBe(1); // an inline span: one box per line
});

test('a lone link on an error card lines its words up with the card’s text', async ({ context, extensionId, serviceWorker }) => {
  await installProviderMock(context, { answers: [{ chunks: [], delayMs: 10, status: 401 }] });
  await mockSalesforce(context);
  await seedReadyKey(serviceWorker);
  const panel = await openFlow(context, extensionId);
  await panel.getByLabel('Message').fill('Hi');
  await panel.getByLabel('Message').press('Enter');
  const card = panel.getByRole('alert');
  await expect(card).toBeVisible();
  const link = card.getByRole('button');
  await expect(link).toHaveCount(1);
  const [title, words] = await Promise.all([
    card.locator('p').first().evaluate((el) => el.getBoundingClientRect().left),
    link.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect().left;
    }),
  ]);
  expect(Math.abs(words - title)).toBeLessThan(1);
});

test('a key checked a day ago or more has its model list read again when the panel opens: Opus 5.5 appears with no key pasted again; the demo reads nothing', async ({ context, extensionId, serviceWorker }) => {
  await installProviderMock(context, { answers: [{ chunks: ['ok'], delayMs: 10 }] });
  await mockSalesforce(context);
  const settings = structuredClone(READY_SETTINGS);
  settings.keys.anthropic.models = [
    { id: 'claude-sonnet-5', maxInputTokens: 1_000_000 },
    { id: 'claude-opus-5', maxInputTokens: 1_000_000 },
  ];
  settings.keys.anthropic.checkedAt = 1; // checked long ago, with a list that predates Opus 5.5
  await seedStorage(serviceWorker, { settings, 'apiKey:anthropic': SEEDED_KEY });

  // The demo first: it sends nothing, the list refresh included.
  const demo = await context.newPage();
  await demo.goto(`chrome-extension://${extensionId}/sidepanel.html?demo=1`);
  await expect(demo.getByRole('heading', { level: 1 })).toBeVisible();
  await demo.waitForTimeout(500);
  expect(await providerCalls(demo)).toEqual([]);
  await demo.close();

  const panel = await openFlow(context, extensionId);
  await expect.poll(async () => (await providerCalls(panel)).filter((c) => c.url.includes('/v1/models')).length).toBe(1);
  await expect.poll(async () => ((await readStorage(serviceWorker, 'settings')) as typeof settings).keys.anthropic.models.map((m) => m.id)).toContain('claude-opus-5-5');
  await panel.getByRole('button', { name: 'Claude Sonnet 5' }).click();
  await expect(panel.getByRole('menuitem', { name: /Claude Opus 5\.5/ })).toContainText('Most capable');

  // Opened again the same day: nothing is read.
  await panel.reload();
  await expect(panel.getByLabel('Message')).toBeEnabled();
  await panel.waitForTimeout(500);
  expect((await providerCalls(panel)).filter((c) => c.url.includes('/v1/models'))).toEqual([]);
});
