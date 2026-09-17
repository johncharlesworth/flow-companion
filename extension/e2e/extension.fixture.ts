import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { type BrowserContext, chromium, type Page, test as base, type Worker } from '@playwright/test';

export const outDir = path.resolve(import.meta.dirname, '../.output/chrome-mv3');

type Fixtures = {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
  /** Every CSP violation any page in the context reported; a spec fails if there was one. */
  cspViolations: string[];
};

// Loads the production build (`npm run build` first) into a fresh Chromium
// profile. Chrome's new headless mode supports extensions, so this runs in CI.
export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    if (!fs.existsSync(path.join(outDir, 'manifest.json'))) {
      throw new Error('No production build found. Run `npm run build` before `npm run e2e`.');
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-companion-e2e-'));
    try {
      const context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chromium',
        args: [`--disable-extensions-except=${outDir}`, `--load-extension=${outDir}`],
      });
      try {
        await use(context);
      } finally {
        await context.close();
      }
    } finally {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  },
  // The background service worker registers a moment after launch; wait for it.
  serviceWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker');
    await use(worker);
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
  // The manifest's CSP is a security boundary: a violation anywhere
  // in a spec, on any page, means the panel tried to load something it should
  // not, or the policy broke something the panel needs. Either fails the spec.
  cspViolations: [
    async ({ context }, use) => {
      const violations: string[] = [];
      const watch = (page: Page) =>
        page.on('console', (message) => {
          if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) violations.push(`${page.url()}: ${message.text()}`);
        });
      context.pages().forEach(watch);
      context.on('page', watch);
      await use(violations);
      expect(violations, 'CSP violations').toEqual([]);
    },
    { auto: true },
  ],
});

export const expect = test.expect;
