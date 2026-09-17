import { expect, test } from './extension.fixture';
import { installProviderMock, messageCalls, providerCalls } from './provider-mock';
import { readStorage, seedReadyKey } from './salesforce.mock';

// Demo mode: the panel as a normal tab on the bundled
// sample flow. No Salesforce tab, cookie, or Tooling call is involved; a key
// is all it takes to chat.

const DEMO_URL = (id: string) => `chrome-extension://${id}/sidepanel.html?demo=1`;
const DEMO_CHAT_KEY = 'chat:demo:300XXXX0000ABCDxyz';

test('the demo tab loads the sample flow and chats about it with the user’s key, never touching Salesforce', async ({ context, extensionId, serviceWorker }) => {
  await installProviderMock(context, { answers: [{ chunks: ['It routes **Account** updates ', 'by customer type.'], delayMs: 30 }] });
  await seedReadyKey(serviceWorker);
  const salesforceRequests: string[] = [];
  await context.route(/salesforce\.com|force\.com/, (route) => {
    salesforceRequests.push(route.request().url());
    return route.fulfill({ status: 500, body: 'unexpected' });
  });

  const demo = await context.newPage();
  await demo.goto(DEMO_URL(extensionId));
  await expect(demo.getByRole('heading', { level: 1 })).toHaveText('Customer Tier Routing Flow');
  await expect(demo.getByText('v4 · Active')).toBeVisible();
  await expect(demo.getByText('Saved just now')).toBeVisible();
  await expect(demo.getByText('Ready. Ask anything about this flow.')).toBeVisible();

  await demo.getByLabel('Message').fill('What does this flow do?');
  await demo.getByLabel('Message').press('Enter');
  await expect(demo.getByRole('log')).toContainText('It routes Account updates by customer type.');
  await expect(demo.getByRole('button', { name: 'Send' })).toBeVisible();

  expect(salesforceRequests).toEqual([]);
  const [sent] = messageCalls(await providerCalls(demo));
  const body = sent?.body as { messages: { content: { text: string }[] }[] };
  expect(body.messages[0]?.content[0]?.text).toContain('CheckCustomerType'); // the sample flow went to the provider
  const stored = (await readStorage(serviceWorker, DEMO_CHAT_KEY)) as { turns: unknown[] };
  expect(stored.turns).toHaveLength(2);
});

test('"Try the demo" in Settings opens the demo in a new tab', async ({ context, extensionId, serviceWorker }) => {
  await seedReadyKey(serviceWorker);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'More' }).click();
  await panel.getByRole('menuitem', { name: 'Settings' }).click();
  const [demo] = await Promise.all([context.waitForEvent('page'), panel.getByRole('link', { name: 'Try the demo' }).click()]);
  await demo.waitForLoadState();
  expect(new URL(demo.url()).pathname + new URL(demo.url()).search).toBe('/sidepanel.html?demo=1');
  await expect(demo.getByRole('heading', { level: 1 })).toHaveText('Customer Tier Routing Flow');
  // Inside the demo, Settings does not offer the demo again.
  await demo.getByRole('button', { name: 'More' }).click();
  await demo.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(demo.getByRole('heading', { level: 1 })).toHaveText('Settings');
  await expect(demo.getByRole('link', { name: 'Try the demo' })).toHaveCount(0);
});
