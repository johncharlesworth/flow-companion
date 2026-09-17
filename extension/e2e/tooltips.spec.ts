import { expect, test } from './extension.fixture';
import { installProviderMock } from './provider-mock';
import { FLOW_A, FLOW_A_LABEL, mockSalesforce, seedReadyKey } from './salesforce.mock';

// Every icon-only control explains itself on hover.

test('the header buttons, the flow chip, the model chip, and quick actions show their tooltips on hover', async ({ context, extensionId, serviceWorker }) => {
  await installProviderMock(context, { answers: [{ chunks: ['ok'], delayMs: 10 }] });
  await mockSalesforce(context);
  await seedReadyKey(serviceWorker);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const flowTab = await context.newPage();
  await flowTab.goto(FLOW_A);
  await flowTab.bringToFront();
  await expect(panel.getByRole('heading', { level: 1 })).toHaveText(FLOW_A_LABEL);

  const cases: [string, RegExp][] = [
    ['New chat', /^New chat\. The flow stays attached; the first question in a new chat sends it again\.$/],
    ['Refresh', /^Save in Builder, then refresh$/],
    ['Quick actions', /^Overview, explain an element, document, draw$/],
    ['Claude Sonnet 5', /^Choose a model$/],
  ];
  for (const [name, text] of cases) {
    await panel.getByRole('button', { name }).hover();
    await expect(panel.getByRole('tooltip')).toHaveText(text, { timeout: 3_000 });
    await panel.mouse.move(0, 0);
    await expect(panel.getByRole('tooltip')).toHaveCount(0);
  }
  const chip = panel.getByRole('button', { name: /^About this flow: / });
  await chip.hover();
  await expect(panel.getByRole('tooltip')).toContainText('Your first question sends the whole flow to Anthropic. Follow-ups in this chat reuse it, so they’re quicker and cheaper.', { timeout: 3_000 });
  // A click pins the same story until Escape or a click elsewhere (the hover invited it).
  await chip.click();
  const card = panel.getByRole('dialog');
  await expect(card).toContainText('No questions yet');
  await expect(card).not.toContainText(FLOW_A_LABEL);
  await expect(card.getByRole('definition')).toHaveText(['0 tokens', '0', '0']);
  await expect(card).toContainText('Your first question sends the whole flow to Anthropic. Follow-ups in this chat reuse it, so they’re quicker and cheaper.');
  await expect(panel.getByRole('tooltip')).toHaveCount(0);
  // Anchored to the chip, not the panel's corner.
  const [chipBox, cardBox] = [await chip.boundingBox(), await card.boundingBox()];
  expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(chipBox!.y + 1);
  expect(Math.abs(cardBox!.x - chipBox!.x)).toBeLessThan(40);
  await panel.keyboard.press('Escape');
  await expect(panel.getByRole('dialog')).toHaveCount(0);

  // After an answer, the hover is one line of numbers and the card is the breakdown.
  await panel.getByLabel('Message').fill('Hi');
  await panel.getByLabel('Message').press('Enter');
  await expect(panel.getByRole('log')).toContainText('ok');
  await panel.mouse.move(0, 0); // a fresh hover, not the pointer left over from the click
  await chip.hover();
  await expect(panel.getByRole('tooltip')).toHaveText('First question: 1,300 tokens sent, 3 in the answer', { timeout: 3_000 });
  await chip.click();
  await expect(card).toContainText('Last question');
  await expect(card.getByRole('term')).toHaveText(['Sent', 'Reused from Anthropic’s memory', 'In the answer']);
  await expect(card.getByRole('definition')).toHaveText(['1,300 tokens', '0', '3']);
  await expect(card).toContainText('Your first question sends the whole flow to Anthropic. Follow-ups in this chat reuse it, so they’re quicker and cheaper.');
  await panel.keyboard.press('Escape');
});
