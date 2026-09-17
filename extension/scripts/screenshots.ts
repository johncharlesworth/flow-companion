// Renders every gallery screen as a contact sheet (320/400/600 px × light/dark)
// into .output/screenshots/ (or SCREENSHOTS_DIR). Needs a build
// that includes the gallery page (`npm run build:gallery`; a plain build leaves
// it out of the package) and Playwright's Chromium. `npm run screenshots` does
// both.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const outDir = fileURLToPath(new URL('../.output/chrome-mv3/', import.meta.url));
const shotsDir = process.env.SCREENSHOTS_DIR ? path.resolve(process.env.SCREENSHOTS_DIR) : fileURLToPath(new URL('../.output/screenshots/', import.meta.url));
fs.mkdirSync(shotsDir, { recursive: true });

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-flow-chat-shots-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  args: [`--disable-extensions-except=${outDir}`, `--load-extension=${outDir}`],
  viewport: { width: 1500, height: 1500 },
  deviceScaleFactor: 1,
});
try {
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/gallery.html`);
  const names = await page.locator('li a').allInnerTexts();
  for (const name of names) {
    await page.goto(`chrome-extension://${id}/gallery.html?screen=${name}`);
    await page.locator('[data-sheet-ready]').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => !document.querySelector('.flow-diagram-source[aria-busy="true"]')); // a diagram still being drawn
    await page.locator('#sheet').screenshot({ path: path.join(shotsDir, `${name}.png`) });
    console.log(path.join(shotsDir, `${name}.png`));
  }
} finally {
  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
