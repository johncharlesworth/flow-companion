// Bundle budget, in two parts (decision). STARTUP: everything the side panel loads when it opens, that is
// sidepanel.html, the scripts it references and every chunk they import
// statically (transitively), its stylesheets, and the fonts those reference.
// That stays under 3 MB so opening the panel never slows down. TOTAL: the whole
// unpacked package, including chunks loaded only on demand (the Mermaid
// renderer, the Excalidraw converter), under 6 MB. The check also fails if any
// on-demand chunk (name containing "mermaid" or "excalidraw") is reachable at
// startup: that would mean someone imported it statically.
//
// Raise a budget deliberately in this file, never by editing CI.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const STARTUP_BUDGET_BYTES = 3_000_000;
const TOTAL_BUDGET_BYTES = 6_000_000;
const ON_DEMAND = /mermaid|excalidraw/i;
const ENTRY = 'sidepanel.html';

const outDir = fileURLToPath(new URL('../.output/chrome-mv3/', import.meta.url));

type Entry = { path: string; bytes: number };

function walk(dir: string): Entry[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [{ path: relative(outDir, full).split('\\').join('/'), bytes: statSync(full).size }];
  });
}

/** Files a built file loads at startup: static imports, <script src>, <link href>, url in CSS. Dynamic import is not followed. */
function staticRefs(file: string): string[] {
  const text = readFileSync(join(outDir, file), 'utf8');
  const dir = posix.dirname(file);
  const refs = new Set<string>();
  const add = (raw: string) => {
    const clean = raw.replace(/[?#].*$/, '');
    if (!clean || /^(https?:|data:|chrome)/.test(clean)) return;
    refs.add(posix.normalize(clean.startsWith('/') ? clean.slice(1) : posix.join(dir, clean)));
  };
  if (file.endsWith('.html')) {
    for (const m of text.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/g)) add(m[1]!);
    for (const m of text.matchAll(/<link[^>]*\shref=["']([^"']+)["']/g)) add(m[1]!);
  } else if (file.endsWith('.js')) {
    // `import x from"./a.js"`, `import{a}from"./a.js"`, `export{a}from"./a.js"`, `import"./a.js"`; never `import("./a.js")`.
    for (const m of text.matchAll(/\bfrom\s*["']([^"']+)["']/g)) add(m[1]!);
    for (const m of text.matchAll(/\bimport\s*["']([^"']+)["']/g)) add(m[1]!);
  } else if (file.endsWith('.css')) {
    for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) add(m[1]!);
  }
  return [...refs];
}

function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    try {
      statSync(join(outDir, file));
    } catch {
      continue; // a reference to something outside the build (never happens; skip rather than crash)
    }
    seen.add(file);
    queue.push(...staticRefs(file));
  }
  return seen;
}

let files: Entry[];
try {
  files = walk(outDir).sort((a, b) => b.bytes - a.bytes);
} catch {
  console.error('No production build found. Run `npm run build` first.');
  process.exit(2);
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
const startup = reachableFrom(ENTRY);
const startupBytes = files.filter((f) => startup.has(f.path)).reduce((sum, f) => sum + f.bytes, 0);
const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);

for (const file of files.slice(0, 15)) {
  console.log(`${kb(file.bytes).padStart(10)}  ${startup.has(file.path) ? 'startup   ' : 'on demand '} ${file.path}`);
}
console.log(`${kb(startupBytes).padStart(10)}  startup (${startup.size} files reachable from ${ENTRY}; budget ${kb(STARTUP_BUDGET_BYTES)})`);
console.log(`${kb(totalBytes).padStart(10)}  total (${files.length} files; budget ${kb(TOTAL_BUDGET_BYTES)})`);

let failed = false;
const leaked = [...startup].filter((f) => ON_DEMAND.test(f));
if (leaked.length) {
  failed = true;
  console.error(`On-demand chunks are loaded at startup (imported statically somewhere): ${leaked.join(', ')}`);
}
if (startupBytes > STARTUP_BUDGET_BYTES) {
  failed = true;
  console.error(`Startup is over budget by ${kb(startupBytes - STARTUP_BUDGET_BYTES)}.`);
}
if (totalBytes > TOTAL_BUDGET_BYTES) {
  failed = true;
  console.error(`Package is over budget by ${kb(totalBytes - TOTAL_BUDGET_BYTES)}.`);
}
if (failed) process.exit(1);
