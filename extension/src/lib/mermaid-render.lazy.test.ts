import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';

import { configureMermaid, MERMAID_CONFIG } from './mermaid-render.lazy';

// The renderer's configuration is a security boundary:
// strict mode, plain-text labels, and no way for the diagram text itself to
// change the theme. Mermaid lets a `%%{init: …}%%` directive override any key
// not in its `secure` list, and themeCSS is CSS written straight into the SVG's
// <style>, which applies to the whole panel. cleanMermaid strips directives
// before rendering; this locks the keys as well, so the two layers do not
// depend on each other.

const HOSTILE = '%%{init: {"themeCSS": "} body { display: none } .x {", "theme": "dark", "securityLevel": "loose", "flowchart": {"htmlLabels": true}, "fontFamily": "x"}}%%\nflowchart TD\n  A["Start"] --> B["End"]';

describe('MERMAID_CONFIG', () => {
  it('is strict with plain-text labels and never renders its own error picture', () => {
    expect(MERMAID_CONFIG).toMatchObject({ securityLevel: 'strict', htmlLabels: false, flowchart: { htmlLabels: false }, suppressErrorRendering: true, startOnLoad: false });
  });

  it('a directive in the diagram text cannot change the theme, the CSS, the labels, or the security level', async () => {
    configureMermaid();
    await mermaid.parse(HOSTILE);
    const config = mermaid.mermaidAPI.getConfig();
    expect(config.themeCSS).toBeUndefined();
    expect(config.theme).toBe('neutral');
    expect(config.securityLevel).toBe('strict');
    expect(config.flowchart?.htmlLabels).toBe(false);
    expect(config.fontFamily).toBe(MERMAID_CONFIG.fontFamily);
  });
});
