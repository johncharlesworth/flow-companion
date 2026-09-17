import fs from 'node:fs';
import path from 'node:path';

import { expect, outDir, test } from './extension.fixture';

// The service worker's global, typed just enough for the one call below.
declare const chrome: {
  sidePanel: { getPanelBehavior(): Promise<{ openPanelOnActionClick?: boolean }> };
};

const EXPECTED_HOST_PERMISSIONS = [
  'https://*.my.salesforce.com/*',
  'https://*.my.salesforce-setup.com/*',
  'https://*.lightning.force.com/*',
  'https://api.anthropic.com/*',
  'https://api.openai.com/*',
  'https://generativelanguage.googleapis.com/*',
].sort();

test('the built manifest is exactly what the extension needs', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8')) as {
    manifest_version: number;
    minimum_chrome_version?: string;
    permissions?: string[];
    optional_permissions?: string[];
    host_permissions?: string[];
    side_panel?: { default_path?: string };
    background?: { service_worker?: string };
    action?: { default_title?: string };
    icons?: Record<string, string>;
    content_security_policy?: { extension_pages?: string };
    content_scripts?: unknown[];
    optional_host_permissions?: string[];
  };

  expect(manifest.manifest_version).toBe(3);
  expect(manifest.minimum_chrome_version).toBe('114');
  expect([...(manifest.permissions ?? [])].sort()).toEqual(['cookies', 'sidePanel', 'storage']);
  expect(manifest.optional_permissions ?? []).toEqual([]);
  expect(manifest.optional_host_permissions ?? []).toEqual([]);
  expect(manifest.content_scripts ?? []).toEqual([]);
  expect([...(manifest.host_permissions ?? [])].sort()).toEqual(EXPECTED_HOST_PERMISSIONS);
  expect(manifest.side_panel?.default_path).toBe('sidepanel.html');
  expect(manifest.background?.service_worker).toBeTruthy();
  expect(manifest.action?.default_title).toBeTruthy();
  // The CSP at the browser level: the page loads nothing from
  // anywhere but itself, no remote images, fonts, or frames, and connects only
  // to My-Domain Tooling hosts and the three providers (invariant 3). Never
  // *.lightning.force.com, never a dev server in a production build.
  const csp = Object.fromEntries(
    (manifest.content_security_policy?.extension_pages ?? '')
      .split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name, sources.sort()]),
  );
  expect(csp).toEqual({
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'object-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:'],
    'connect-src': [
      "'self'",
      'https://*.my.salesforce.com',
      'https://*.my.salesforce-setup.com',
      'https://api.anthropic.com',
      'https://api.openai.com',
      'https://generativelanguage.googleapis.com',
    ].sort(),
  });
  for (const size of ['16', '32', '48', '128']) {
    const icon = manifest.icons?.[size];
    expect(icon, `icon ${size}`).toBeTruthy();
    expect(fs.existsSync(path.join(outDir, icon ?? ''))).toBe(true);
  }
});

test('the background script makes the toolbar icon open the panel', async ({ serviceWorker }) => {
  await expect
    .poll(async () => (await serviceWorker.evaluate(() => chrome.sidePanel.getPanelBehavior())).openPanelOnActionClick)
    .toBe(true);
});

test('the side panel page renders the placeholder', async ({ context, extensionId }) => {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.setViewportSize({ width: 400, height: 640 });
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Flow Companion');
  await page.screenshot({ path: 'test-results/sidepanel-placeholder.png' });

  expect(errors).toEqual([]);
});
