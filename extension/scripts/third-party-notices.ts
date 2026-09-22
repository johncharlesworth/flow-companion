// Writes public/THIRD-PARTY-NOTICES.txt and public/LICENSE.txt, which WXT
// copies into the built package, so the zip a user installs carries every
// bundled dependency's licence text (the bundler strips licence comments)
// and our own licence and copyright. Run by `npm run zip`.
//
// The list comes from package-lock.json: every installed package that is not
// dev-only. Licence texts are read from each package's LICENSE/LICENCE/COPYING
// file; a package without one is listed with its declared licence identifier.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as {
  packages: Record<string, { version?: string; dev?: boolean; license?: string; optional?: boolean }>;
};
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string; version: string };

type Notice = { name: string; version: string; license: string; text: string | null };

function licenseText(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const file = readdirSync(dir).find((f) => /^(LICENSE|LICENCE|COPYING)(\.(md|txt|markdown))?$/i.test(f));
  return file ? readFileSync(join(dir, file), 'utf8').trim() : null;
}

const notices: Notice[] = [];
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path || entry.dev) continue;
  const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const dir = join(root, path);
  let license = entry.license ?? '';
  if (!license && existsSync(join(dir, 'package.json'))) {
    const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { license?: string | { type?: string } };
    license = typeof meta.license === 'string' ? meta.license : (meta.license?.type ?? '');
  }
  const text = licenseText(dir);
  notices.push({ name, version: entry.version ?? '', license: license || (text ? 'see the text below' : 'not declared'), text });
}
notices.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const missing = notices.filter((n) => !n.text);
const header = [
  'Flow Companion for Salesforce',
  `Version ${pkg.version}`,
  'Copyright (C) 2026 Charlesworth Holdings LLC',
  '',
  'Licensed under the GNU General Public License, version 3. The licence text is',
  'in LICENSE.txt beside this file. Source code: https://github.com/johncharlesworth/flow-companion',
  '',
  `This package bundles the ${notices.length} open-source packages listed below, each under its own`,
  'licence. Their notices and licence texts follow.',
  '',
  '='.repeat(78),
  '',
].join('\n');

const body = notices
  .map((n) => [`${n.name} ${n.version}`, `Licence: ${n.license}`, '', n.text ?? '(The package ships no licence file; the licence identifier above is the one it declares.)', '', '-'.repeat(78), ''].join('\n'))
  .join('\n');

writeFileSync(join(root, 'public', 'THIRD-PARTY-NOTICES.txt'), header + body);
writeFileSync(join(root, 'public', 'LICENSE.txt'), readFileSync(join(root, '..', 'LICENSE'), 'utf8'));
console.log(`third-party notices: ${notices.length} packages, ${missing.length} without a licence file${missing.length ? ` (${missing.map((n) => n.name).join(', ')})` : ''}`);
