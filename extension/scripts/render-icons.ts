// Renders assets/icon.svg to the PNG sizes Chrome wants, using the Chromium
// that Playwright already installs for the smoke spec. Re-run after editing
// the SVG: `npm run icons`.
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const SIZES = [16, 32, 48, 128];
const svg = readFileSync(new URL('../assets/icon.svg', import.meta.url), 'utf8');
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const outDir = new URL('../public/icon/', import.meta.url);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const size of SIZES) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:transparent">
       <img src="${dataUrl}" width="${size}" height="${size}" style="display:block">
     </body></html>`,
  );
  await page.screenshot({
    path: fileURLToPath(new URL(`${size}.png`, outDir)),
    omitBackground: true,
    clip: { x: 0, y: 0, width: size, height: size },
  });
  console.log(`wrote public/icon/${size}.png`);
}
await browser.close();
