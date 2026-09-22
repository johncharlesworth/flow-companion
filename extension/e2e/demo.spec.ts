import { expect, test } from './extension.fixture';
import { readStorage, seedReadyKey } from './salesforce.mock';

// Demo mode: the panel as a normal tab on the bundled demo flow. No
// Salesforce tab, cookie, or Tooling call is involved. The four actions play
// answers that were recorded from a real model, with or without a key, and
// nothing is sent anywhere; the key only changes what the banner and the
// message box say the next step is.

const DEMO_URL = (id: string) => `chrome-extension://${id}/sidepanel.html?demo=1`;
const DEMO_CHAT_KEY = 'chat:demo:300XXXX0000ABCDxyz';
const RECORDED_CHAT_KEY = 'chat:demo-recorded:300XXXX0000ABCDxyz';
const OFF_MACHINE = /salesforce\.com|force\.com|api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com/;

interface StoredTurn {
  role: string;
  displayText: string;
  mode?: string;
  stopReason?: string;
}

test('with a key, the demo tab still plays recorded answers and sends nothing anywhere; the banner and the box point at Flow Builder', async ({ context, extensionId, serviceWorker }) => {
  await seedReadyKey(serviceWorker);
  // Anything bound for a provider or for Salesforce is refused and counted; the count must stay at zero, key or no key.
  const offMachine: string[] = [];
  await context.route(OFF_MACHINE, (route) => {
    offMachine.push(route.request().url());
    return route.abort();
  });

  const demo = await context.newPage();
  await demo.goto(DEMO_URL(extensionId));
  await expect(demo.getByRole('heading', { level: 1 })).toHaveText('Customer Tier Routing Flow');
  await expect(demo.getByText('v4 · Active')).toBeVisible();
  await expect(demo.getByText('Saved just now')).toBeVisible();
  await expect(demo.getByRole('status').filter({ hasText: 'This is a demo flow.' })).toHaveText(/^This is a demo flow\. The four actions below play real answers, recorded from .+\.$/);
  await expect(demo.getByText('Try one of the four')).toBeVisible();
  await expect(demo.getByText('Ready. Ask anything about this flow.')).toHaveCount(0);
  await expect(demo.getByText('Questions to try')).toHaveCount(0);

  // The message box is off and says where to go; with a key there is no setup link, so Send is alone on the bottom row. No model menu, no plus, no gauge.
  await expect(demo.getByLabel('Message')).toBeDisabled();
  await expect(demo.getByLabel('Message')).toHaveAttribute('placeholder', 'Your API key has been accepted. Open a flow in Flow Builder to ask your own questions.');
  await expect(demo.getByRole('button', { name: 'Send' })).toBeDisabled();
  await expect(demo.getByRole('button', { name: 'Set up your AI' })).toHaveCount(0);
  await expect(demo.getByRole('button', { name: 'Quick actions' })).toHaveCount(0);
  await expect(demo.getByRole('button', { name: /Claude Sonnet 5/ })).toHaveCount(0);
  await expect(demo.getByRole('button', { name: /^About this flow: / })).toHaveCount(0);
  await expect(demo.locator('svg.lucide-gauge')).toHaveCount(0);

  // Overview: the recorded answer plays and the turn completes, under the recorded chat's key; the live chat is never written.
  await demo.getByRole('button', { name: 'Overview' }).click();
  await expect(demo.getByRole('log').locator('span.rounded-pill', { hasText: /^Overview$/ })).toBeVisible();
  await expect(demo.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 20_000 });
  const afterOverview = (await readStorage(serviceWorker, RECORDED_CHAT_KEY)) as { turns: StoredTurn[] };
  expect(afterOverview.turns.map((t) => t.role)).toEqual(['user', 'assistant']);
  expect(afterOverview.turns[1]?.stopReason).toBe('end');
  expect(afterOverview.turns[1]?.displayText.trim().length).toBeGreaterThan(0);
  expect(await readStorage(serviceWorker, DEMO_CHAT_KEY)).toBeUndefined();
  await expect(demo.getByRole('group', { name: 'Try another action' }).getByRole('button')).toHaveText(['Overview', 'Explain an element', 'Document this flow', 'Draw this flow']);

  expect(offMachine).toEqual([]);
});

test('"Try a demo flow" in Settings opens the demo in a new tab', async ({ context, extensionId, serviceWorker }) => {
  await seedReadyKey(serviceWorker);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'More' }).click();
  await panel.getByRole('menuitem', { name: 'Settings' }).click();
  const [demo] = await Promise.all([context.waitForEvent('page'), panel.getByRole('link', { name: 'Try a demo flow' }).click()]);
  await demo.waitForLoadState();
  expect(new URL(demo.url()).pathname + new URL(demo.url()).search).toBe('/sidepanel.html?demo=1');
  await expect(demo.getByRole('heading', { level: 1 })).toHaveText('Customer Tier Routing Flow');
  await expect(demo.getByText('Try one of the four')).toBeVisible(); // recorded, even though a key exists
  // Inside the demo, Settings does not offer the demo again.
  await demo.getByRole('button', { name: 'More' }).click();
  await demo.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(demo.getByRole('heading', { level: 1 })).toHaveText('Settings');
  await expect(demo.getByRole('link', { name: 'Try a demo flow' })).toHaveCount(0);
});

test('with no key, the demo tab plays recorded answers for the actions and sends nothing anywhere', async ({ context, extensionId, serviceWorker }) => {
  // Anything bound for a provider or for Salesforce is refused and counted; the count must stay at zero.
  const offMachine: string[] = [];
  await context.route(OFF_MACHINE, (route) => {
    offMachine.push(route.request().url());
    return route.abort();
  });

  const demo = await context.newPage();
  await demo.goto(DEMO_URL(extensionId));
  await expect(demo.getByRole('heading', { level: 1 })).toHaveText('Customer Tier Routing Flow');
  await expect(demo.getByRole('heading', { level: 2, name: 'Set up your AI' })).toHaveCount(0); // not the gate
  await expect(demo.getByRole('status').filter({ hasText: 'This is a demo flow.' })).toHaveText(/^This is a demo flow\. The four actions below play real answers, recorded from .+\.$/);
  await expect(demo.getByLabel('Message')).toHaveAttribute('placeholder', 'Asking questions requires an API key, but you can demo one of the four actions above.');
  await expect(demo.getByText('Try one of the four')).toBeVisible();
  await expect(demo.getByText('Questions to try')).toHaveCount(0);

  // The message box is off; the banner says why, and the bottom row carries one link beside Send. No plus (the cards and the chip row hold the actions) and no gauge (nothing is sent).
  await expect(demo.getByLabel('Message')).toBeDisabled();
  await expect(demo.getByLabel('Message')).toHaveAttribute('aria-describedby', 'sample-flow-banner');
  await expect(demo.getByRole('button', { name: 'Send' })).toBeDisabled();
  await expect(demo.getByRole('button', { name: 'Quick actions' })).toHaveCount(0);
  await expect(demo.getByRole('button', { name: /^About this flow: / })).toHaveCount(0);
  await expect(demo.locator('svg.lucide-gauge')).toHaveCount(0);
  await expect(demo.getByText('Your own questions need an API key.')).toHaveCount(0);
  const setUp = demo.getByRole('button', { name: 'Set up your AI' });
  await expect(setUp).toBeVisible();
  const [linkBox, sendBox] = [await setUp.boundingBox(), await demo.getByRole('button', { name: 'Send' }).boundingBox()];
  expect(linkBox && sendBox && linkBox.x + linkBox.width <= sendBox.x + 1).toBe(true); // to the left of Send
  expect(linkBox && sendBox && Math.abs(linkBox.y + linkBox.height / 2 - (sendBox.y + sendBox.height / 2)) < 4).toBe(true); // on the same row

  // Overview: the recorded answer streams in and the turn completes.
  const tryAnother = demo.getByRole('group', { name: 'Try another action' });
  await expect(tryAnother).toHaveCount(0); // the cards carry the actions until there is an answer
  await demo.getByRole('button', { name: 'Overview' }).click();
  await expect(demo.getByRole('button', { name: 'Stop' })).toBeVisible(); // playing
  // The four actions stay in sight over the message box, waiting while the answer plays.
  await expect(tryAnother.getByRole('button')).toHaveText(['Overview', 'Explain an element', 'Document this flow', 'Draw this flow']);
  await expect(tryAnother.getByRole('button', { name: 'Document this flow' })).toBeDisabled();
  // The question's pill alone: the answer's own words are not this test's to match.
  await expect(demo.getByRole('log').locator('span.rounded-pill', { hasText: /^Overview$/ })).toBeVisible();
  await expect(demo.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 20_000 });
  const afterOverview = (await readStorage(serviceWorker, RECORDED_CHAT_KEY)) as { turns: StoredTurn[] };
  expect(afterOverview.turns.map((t) => t.role)).toEqual(['user', 'assistant']);
  expect(afterOverview.turns[1]?.stopReason).toBe('end');
  expect(afterOverview.turns[1]?.displayText.trim().length).toBeGreaterThan(0);

  // Document, from the chip row: a second answer arrives and completes.
  await tryAnother.getByRole('button', { name: 'Document this flow' }).click();
  await expect(demo.getByRole('log').locator('span.rounded-pill', { hasText: /^Document$/ })).toBeVisible();
  await expect(demo.getByRole('button', { name: 'Download' })).toBeVisible({ timeout: 20_000 });
  await expect(demo.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 20_000 });
  const afterDocument = (await readStorage(serviceWorker, RECORDED_CHAT_KEY)) as { turns: StoredTurn[] };
  expect(afterDocument.turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  expect(afterDocument.turns[2]?.mode).toBe('document');
  expect(afterDocument.turns[3]?.stopReason).toBe('end');
  expect(afterDocument.turns[3]?.displayText.trim().length).toBeGreaterThan(0);

  // Draw, from the chip row: the recorded diagram renders.
  await tryAnother.getByRole('button', { name: 'Draw this flow' }).click();
  await expect(demo.locator('.flow-diagram svg')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => demo.locator('.flow-diagram svg .node').count()).toBeGreaterThan(2); // the nodes land a beat after the svg

  await expect(demo.getByText(/Couldn’t draw this one/)).toHaveCount(0);
  await expect(demo.getByRole('button', { name: 'Open in Excalidraw' })).toBeVisible();
  await expect(demo.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 20_000 });
  const afterDraw = (await readStorage(serviceWorker, RECORDED_CHAT_KEY)) as { turns: StoredTurn[] };
  expect(afterDraw.turns).toHaveLength(6);
  expect(await readStorage(serviceWorker, DEMO_CHAT_KEY)).toBeUndefined(); // the live chat was never written

  // New chat brings the empty screen back with the outline under the cards; picking an element there plays its explanation at once.
  await demo.getByRole('button', { name: 'New chat' }).click();
  await demo.getByRole('alertdialog', { name: 'Start a new chat?' }).getByRole('button', { name: 'New chat' }).click();
  await expect(demo.getByText('Try one of the four')).toBeVisible();
  await expect(demo.getByText('Pick one to see it explained.')).toBeVisible();
  await demo.getByRole('button', { name: /^Outline/ }).click();
  await demo.getByRole('button', { name: /^Decisions/ }).click();
  await demo.getByRole('option', { name: /CheckCustomerType/ }).click();
  await expect(demo.getByRole('log').locator('span.rounded-pill', { hasText: /^Explain$/ })).toBeVisible();
  await expect(demo.getByRole('log').locator('span.rounded-pill', { hasText: /^CheckCustomerType$/ })).toBeVisible();
  await expect(demo.getByRole('button', { name: /^Remove CheckCustomerType/ })).toHaveCount(0); // nothing attached to the message box
  await expect(demo.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 20_000 });
  const afterExplain = (await readStorage(serviceWorker, RECORDED_CHAT_KEY)) as { turns: StoredTurn[] };
  expect(afterExplain.turns.map((t) => t.role)).toEqual(['user', 'assistant']);
  expect(afterExplain.turns[0]?.mode).toBe('explain');
  expect(afterExplain.turns[1]?.stopReason).toBe('end');
  expect(afterExplain.turns[1]?.displayText.trim().length).toBeGreaterThan(0);

  // The way out of the recording is a key.
  await setUp.click();
  await expect(demo.getByRole('heading', { level: 1 })).toHaveText('Settings');
  await expect(demo.getByText('Anthropic · Claude models')).toBeVisible();
  await expect(demo.getByRole('link', { name: /demo flow/ })).toHaveCount(0); // this already is the demo flow

  expect(offMachine).toEqual([]);
});

test('with no key, "See it on a demo flow first" on the gate opens the demo in a new tab', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Set up your AI');
  await expect(panel.getByText('No key needed. Opens in a new tab.')).toBeVisible();
  const [demo] = await Promise.all([context.waitForEvent('page'), panel.getByRole('link', { name: 'See it on a demo flow first' }).click()]);
  await demo.waitForLoadState();
  expect(new URL(demo.url()).pathname + new URL(demo.url()).search).toBe('/sidepanel.html?demo=1');
  await expect(demo.getByRole('heading', { level: 1 })).toHaveText('Customer Tier Routing Flow');
  await expect(demo.getByText('Try one of the four')).toBeVisible();
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Set up your AI'); // the panel itself stays where it was
});
