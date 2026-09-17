import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// The design rule: "All text tokens meet 4.5:1 on their surface in both themes;
// verify with the real values." This test is that verification,
// run against the CSS itself so the two cannot drift apart.
const css = fs.readFileSync(path.join(process.cwd(), 'src/styles/app.css'), 'utf8');

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf('{', css.indexOf(selector));
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!.toLowerCase()]));
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const PAIRS: [text: string, surface: string][] = [
  ['text-1', 'bg'],
  ['text-1', 'surface'],
  ['text-1', 'surface-elevated'],
  ['text-2', 'bg'],
  ['text-2', 'surface'],
  ['text-2', 'surface-elevated'],
  ['text-3', 'bg'],
  ['text-3', 'surface'],
  ['accent', 'bg'],
  ['accent-fg', 'accent'],
  ['danger', 'bg'],
];

describe.each([
  ['light', ":root,\n[data-theme='light']"],
  ['dark', "[data-theme='dark']"],
])('%s theme', (_name, selector) => {
  const t = tokens(selector);

  it('defines the complete token table', () => {
    for (const name of ['bg', 'surface', 'surface-elevated', 'composer-field', 'border-hairline', 'text-1', 'text-2', 'text-3', 'accent', 'accent-fg', 'accent-subtle', 'success', 'warning', 'danger']) {
      expect(t[name], name).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it.each(PAIRS)('%s on %s reaches 4.5:1', (text, surface) => {
    expect(contrast(t[text]!, t[surface]!)).toBeGreaterThanOrEqual(4.5);
  });
});

it('the system-dark media block carries the same values as the explicit dark theme', () => {
  const explicit = tokens("[data-theme='dark']");
  const media = tokens(":root:not([data-theme='light'])");
  expect(media).toEqual(explicit);
});
