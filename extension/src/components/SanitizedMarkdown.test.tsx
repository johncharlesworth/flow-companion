import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { DIAGRAM_FAILED } from './FlowDiagram';
import { HARDEN_OPTIONS, REHYPE_PLUGINS, SanitizedMarkdown } from './SanitizedMarkdown';

// The renderer is loaded on demand and needs a real browser; here it is scripted.
const renderDiagram = vi.fn(async (text: string) => {
  if (text.includes('BROKEN')) throw new Error('Parse error on line 2');
  return `<svg viewBox="0 0 10 10" data-test="drawn"><g class="node"><rect></rect></g><script>window.__pwned = true</script></svg>`;
});
vi.mock('@/lib/mermaid-render.lazy', () => ({ renderDiagram: (text: string) => renderDiagram(text) }));

describe('SanitizedMarkdown (XSS hardening — invariant 5)', () => {
  test('renders <script> tags as text, not as executable elements', () => {
    const { container } = render(<SanitizedMarkdown markdown="hello <script>alert('xss')</script> world" />);
    expect(container.querySelector('script')).toBeNull();
  });

  test('strips javascript: URLs from links', () => {
    const { container } = render(<SanitizedMarkdown markdown="[click me](javascript:alert(1))" />);
    const link = container.querySelector('a');
    if (link) {
      const href = link.getAttribute('href');
      if (href !== null) expect(href).not.toMatch(/^javascript:/i);
    }
  });

  test('strips onerror handlers from images', () => {
    const { container } = render(<SanitizedMarkdown markdown='![alt](https://example.com/x.png "<img src=x onerror=alert(1)>")' />);
    container.querySelectorAll('img').forEach((img) => {
      expect(img.getAttribute('onerror')).toBeNull();
    });
  });

  test('renders ordinary markdown (headings, bold, code) correctly', () => {
    render(<SanitizedMarkdown markdown="**bold** and `code`" />);
    expect(screen.getByText('bold')).toBeInTheDocument();
    expect(screen.getByText('code')).toBeInTheDocument();
  });

  test('renders nested HTML inside code blocks as code, not as elements', () => {
    const { container } = render(<SanitizedMarkdown markdown={'```\n<script>evil</script>\n```'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('code')).not.toBeNull();
  });

  // Added with the sanitiser rewrite:
  test('a raw <img onerror> renders no img at all (answers never contain images)', () => {
    const { container } = render(<SanitizedMarkdown markdown={'before <img src="x" onerror="alert(1)"> after ![pic](https://example.com/a.png)'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('before');
  });

  test('http: and javascript: links render no href; https links keep it and open in a new tab', () => {
    const { container } = render(<SanitizedMarkdown markdown={'[a](http://example.com) [b](javascript:alert(1)) [c](https://help.salesforce.com/x)'} />);
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs.filter((h) => h?.startsWith('http://'))).toEqual([]);
    expect(hrefs.filter((h) => h?.toLowerCase().startsWith('javascript:'))).toEqual([]);
    const safe = [...container.querySelectorAll('a')].find((a) => a.getAttribute('href') === 'https://help.salesforce.com/x');
    expect(safe).toBeTruthy();
    expect(safe?.getAttribute('target')).toBe('_blank');
    expect(safe?.getAttribute('rel')).toContain('noreferrer');
  });

  test('event handlers, iframes, forms, and style blocks never survive', () => {
    const { container } = render(
      <SanitizedMarkdown markdown={'<div onclick="x()">d</div><iframe src="https://evil.example"></iframe><form action="https://evil.example"><input name="k"></form><style>body{display:none}</style><a href="https://ok.example" onmouseover="x()">ok</a>'} />,
    );
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('style')).toBeNull();
    expect(container.querySelector('[onclick], [onmouseover]')).toBeNull();
  });

  test('the rehype pipeline is raw → sanitize → harden with the locked options (snapshot)', () => {
    const shape = REHYPE_PLUGINS.map((p) => (Array.isArray(p) ? [(p[0] as { name: string }).name, p[1]] : (p as { name: string }).name));
    expect(shape).toMatchSnapshot();
    expect(HARDEN_OPTIONS).toEqual({ allowedLinkPrefixes: ['https://'], allowedImagePrefixes: [], allowDataImages: false, allowedProtocols: ['https'] });
  });

  test('tables, lists, and a long formula render inside the answer', () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n- two\n\n```\nAND({!$Record.AnnualRevenue} > 1000000, {!AccountAgeInDays} > 365, NOT(ISBLANK({!$Record.Industry})), {!$Record.NumberOfEmployees} >= 250)\n```';
    const { container } = render(<SanitizedMarkdown markdown={md} />);
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.textContent).toContain('AccountAgeInDays');
  });
});

describe('Draw this flow: diagrams render through the custom renderer', () => {
  const DIAGRAM = '```mermaid\nflowchart TD\n  A["Start"] --> B["End"]\n```\n\nTwo steps.';

  test('a closed mermaid block becomes an inert SVG in a container React does not manage; the outcome is reported', async () => {
    renderDiagram.mockClear();
    const onOutcome = vi.fn();
    const { container } = render(<SanitizedMarkdown markdown={DIAGRAM} diagram={{ onOutcome }} />);
    await waitFor(() => expect(container.querySelector('.flow-diagram svg[data-test="drawn"]')).not.toBeNull());
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    expect(screen.getByRole('img', { name: 'Flow diagram' })).toBeInTheDocument();
    expect(onOutcome).toHaveBeenCalledWith('rendered');
    expect(renderDiagram).toHaveBeenCalledTimes(1);
    expect(renderDiagram.mock.calls[0]?.[0]).toBe('flowchart TD\n  A["Start"] --> B["End"]');
    expect(container.textContent).toContain('Two steps.');
  });

  test('the same diagram rendered again comes from the cache, not a second render', async () => {
    renderDiagram.mockClear();
    const { container } = render(<SanitizedMarkdown markdown={DIAGRAM} />);
    await waitFor(() => expect(container.querySelector('.flow-diagram svg')).not.toBeNull());
    expect(renderDiagram).not.toHaveBeenCalled();
  });

  test('while streaming, an open mermaid fence shows as plain code and nothing is drawn', async () => {
    renderDiagram.mockClear();
    const { container } = render(<SanitizedMarkdown markdown={'Here it is.\n\n```mermaid\nflowchart TD\n  A["Start"] -->'} streaming />);
    expect(container.querySelector('code')).not.toBeNull();
    expect(container.textContent).toContain('flowchart TD');
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector('svg')).toBeNull();
    expect(renderDiagram).not.toHaveBeenCalled();
  });

  test('a diagram Mermaid cannot parse shows the line, the text, and Try again, which re-sends', async () => {
    const onTryAgain = vi.fn();
    const onOutcome = vi.fn();
    const { container } = render(<SanitizedMarkdown markdown={'```mermaid\nflowchart TD\n  A[BROKEN --> \n```'} diagram={{ onTryAgain, onOutcome }} />);
    await waitFor(() => expect(screen.getByText(DIAGRAM_FAILED)).toBeInTheDocument());
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toContain('BROKEN');
    expect(onOutcome).toHaveBeenCalledWith('failed');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onTryAgain).toHaveBeenCalledOnce();
  });

  test('without a Try again handler (an older answer) the failure state has no button', async () => {
    render(<SanitizedMarkdown markdown={'```mermaid\nflowchart TD\n  B[BROKEN too --> \n```'} />);
    await waitFor(() => expect(screen.getByText(DIAGRAM_FAILED)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});
