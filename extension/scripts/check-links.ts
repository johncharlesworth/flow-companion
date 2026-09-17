// Checks that every provider page the product links to still answers
// (`Get a key`, pricing, billing, rate limits). A provider can move a page at
// any time; this catches it before a release and, from CI's weekly schedule,
// in between. Reads the URLs out of the two source files so there is one list.
//
//   npm run links
//
// 404 and 410 fail. 403 and 429 pass with a note (bot protection, not a dead
// page). Network errors fail. The GitHub link is skipped until the repo is
// public.

import { readFileSync } from 'node:fs';
import path from 'node:path';

const SOURCES = ['src/lib/provider-links.ts', 'src/lib/chat-errors.ts'];
const TIMEOUT_MS = 15_000;

const urls = new Set<string>();
for (const file of SOURCES) {
  const text = readFileSync(path.join(process.cwd(), file), 'utf8');
  for (const match of text.matchAll(/https:\/\/[^'"`\s)]+/g)) {
    if (!match[0].includes('github.com')) urls.add(match[0]);
  }
}

let failed = 0;
for (const url of [...urls].sort()) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (sf-flow-chat link check)', accept: 'text/html,*/*' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const dead = response.status === 404 || response.status === 410;
    const guarded = response.status === 403 || response.status === 429;
    if (dead) failed += 1;
    console.log(`${dead ? 'DEAD' : guarded ? 'ok? ' : 'ok  '}  ${response.status}  ${url}${guarded ? '  (bot protection; open it by hand if unsure)' : ''}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ---  ${url}  (${error instanceof Error ? error.message : String(error)})`);
  }
}

console.log(`\n${urls.size} links checked, ${failed} failed.`);
if (failed > 0) process.exit(1);
