import { expect, test } from './extension.fixture';
import { installProviderMock } from './provider-mock';
import { FLOW_A, FLOW_A_LABEL, mockSalesforce, seedReadyKey } from './salesforce.mock';

// Every icon-only control explains itself on hover.

test('the header buttons, the model chip, Actions, and the gauge show their tooltips on hover', async ({ context, extensionId, serviceWorker }) => {
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
    ['Actions', /^Overview, draw, document, explain an element$/],
    ['Claude Sonnet 5', /^Choose a model$/],
  ];
  // The model name darkens on hover like the gauge and Stop, rather than keeping its grey under the fill.
  const modelChip = panel.getByRole('button', { name: 'Claude Sonnet 5' });
  const ink = () => modelChip.evaluate((el) => getComputedStyle(el).color);
  const restInk = await ink();
  await modelChip.hover();
  await expect.poll(ink).not.toBe(restInk);
  await expect.poll(ink).toBe(await panel.getByRole('button', { name: 'Actions' }).evaluate((el) => getComputedStyle(el).color));
  await panel.mouse.move(0, 0);
  // Actions' outline is the message box's own border colour, which still reads in dark.
  const border = (sel: string) => panel.locator(sel).first().evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(await panel.getByRole('button', { name: 'Actions' }).evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(await border('div.rounded-composer.bg-composer'));
  for (const [name, text] of cases) {
    await panel.getByRole('button', { name }).hover();
    await expect(panel.getByRole('tooltip')).toHaveText(text, { timeout: 3_000 });
    await panel.mouse.move(0, 0);
    await expect(panel.getByRole('tooltip')).toHaveCount(0);
  }
  // The gauge on the bottom row carries the flow's story: hover is one line, a click pins the card.
  const chip = panel.getByRole('button', { name: /^About this flow: / });
  await chip.hover();
  await expect(panel.getByRole('tooltip')).toContainText('Your first question sends the whole flow to Anthropic. Follow-ups in this chat are cached and reuse it from memory.', { timeout: 3_000 });
  // A click pins the same story until Escape or a click elsewhere (the hover invited it).
  await chip.click();
  const card = panel.getByRole('dialog');
  await expect(card).toContainText('No questions yet');
  await expect(card).not.toContainText(FLOW_A_LABEL);
  await expect(card.getByRole('definition')).toHaveText(['0 tokens', '0', '0']);
  await expect(card).toContainText('Your first question sends the whole flow to Anthropic. Follow-ups in this chat are cached and reuse it from memory.');
  await expect(panel.getByRole('tooltip')).toHaveCount(0);
  // Pinned, the gauge carries the accent fill; focused by keyboard with its tooltip up, it does not.
  const fill = () => chip.evaluate((el) => getComputedStyle(el).backgroundColor);
  await panel.mouse.move(0, 0);
  await expect.poll(fill).toBe('rgb(224, 238, 240)');
  // Anchored above the gauge with its right edge on the gauge's, not in the panel's corner.
  const [chipBox, cardBox] = [await chip.boundingBox(), await card.boundingBox()];
  expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(chipBox!.y + 1);
  expect(Math.abs(cardBox!.x + cardBox!.width - (chipBox!.x + chipBox!.width))).toBeLessThan(40);
  // Bottom row, left to right: Actions, the slack, the model chip, the gauge, Send.
  const [actionsBox, modelBox, sendBox] = [
    await panel.getByRole('button', { name: 'Actions' }).boundingBox(),
    await panel.getByRole('button', { name: /Claude Sonnet/ }).boundingBox(),
    await panel.getByRole('button', { name: 'Send' }).boundingBox(),
  ];
  // The model chip, the gauge and Send are one group at the right, eight pixels apart.
  expect(chipBox!.x - (modelBox!.x + modelBox!.width)).toBeGreaterThanOrEqual(8);
  expect(chipBox!.x - (modelBox!.x + modelBox!.width)).toBeLessThanOrEqual(10);
  // Send sits a touch further out than the row's 8px, so the primary button has
  // its own air. The panel's rem is 14px, so the row's gap-2 is 7px and Send's
  // ml-[5px] takes it to 12px.
  expect(sendBox!.x - (chipBox!.x + chipBox!.width)).toBeGreaterThanOrEqual(11);
  expect(sendBox!.x - (chipBox!.x + chipBox!.width)).toBeLessThanOrEqual(13);
  // Actions is pushed to the far left, so the slack sits between it and that group.
  expect(modelBox!.x - (actionsBox!.x + actionsBox!.width)).toBeGreaterThan(9);
  expect(Math.abs(chipBox!.y - sendBox!.y)).toBeLessThan(4);
  await panel.keyboard.press('Escape');
  await expect(panel.getByRole('dialog')).toHaveCount(0);
  // Back onto the gauge from the keyboard: its tooltip opens, and it shows the focus ring alone.
  await panel.keyboard.press('Shift+Tab');
  await panel.keyboard.press('Tab');
  await expect(chip).toBeFocused();
  await expect(panel.getByRole('tooltip')).toHaveCount(1, { timeout: 3_000 });
  await expect.poll(fill).toBe('rgba(0, 0, 0, 0)');
  await panel.keyboard.press('Escape');

  // At 320px, the narrowest a side panel goes, the default model's name still fits
  // whole and keeps its 9px to the gauge. Narrower than that, the name ends in an
  // ellipsis and the 9px holds: it never runs under the gauge, which it would if
  // the chip's wrapper could not shrink.
  const model = panel.getByRole('button', { name: /Claude Sonnet/ });
  const label = model.locator('span.truncate');
  const clipped = () => label.evaluate((el) => el.scrollWidth > el.clientWidth);
  const modelToGauge = async () => {
    const [m, g] = [await model.boundingBox(), await chip.boundingBox()];
    return g!.x - (m!.x + m!.width);
  };
  const viewport = panel.viewportSize()!;
  await panel.setViewportSize({ width: 320, height: viewport.height });
  await expect.poll(clipped).toBe(false);
  await expect.poll(modelToGauge).toBeCloseTo(9, 0);
  await panel.setViewportSize({ width: 280, height: viewport.height });
  await expect.poll(clipped).toBe(true);
  await expect.poll(modelToGauge).toBeCloseTo(9, 0);
  await panel.setViewportSize(viewport);

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
  await expect(card).toContainText('Your first question sends the whole flow to Anthropic. Follow-ups in this chat are cached and reuse it from memory.');
  await panel.keyboard.press('Escape');
});
