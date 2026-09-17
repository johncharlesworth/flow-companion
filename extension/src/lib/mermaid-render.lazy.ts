// The Mermaid renderer, loaded only when a diagram is on screen (,
//). Nothing imports this module statically: FlowDiagram
// reaches it through `import`, so the panel starts without the 2 MB chunk
// and the bundle check fails if that ever changes. Strict mode: Mermaid runs
// its output through DOMPurify, labels are plain text (no HTML), and click
// handlers are disabled.

import mermaid, { type MermaidConfig } from 'mermaid';

export const FONT_FAMILY = '"IBM Plex Sans", system-ui, sans-serif';

/**
 * Keys a `%%{init: …}%%` directive inside the diagram text may not change:
 * Mermaid's own defaults, plus everything about the theme and the labels.
 * themeCSS in particular is CSS written into the SVG's <style>, which applies
 * to the whole panel. cleanMermaid strips directives before rendering; this
 * holds even if a directive gets through.
 */
export const SECURE_KEYS = ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges', 'theme', 'themeVariables', 'themeCSS', 'fontFamily', 'fontSize', 'htmlLabels', 'flowchart'];

export const MERMAID_CONFIG: MermaidConfig = {
  startOnLoad: false,
  securityLevel: 'strict',
  secure: SECURE_KEYS,
  htmlLabels: false,
  theme: 'neutral',
  fontFamily: FONT_FAMILY,
  fontSize: 13,
  flowchart: { htmlLabels: false, useMaxWidth: true, curve: 'basis', padding: 8 },
  suppressErrorRendering: true,
  maxTextSize: 50_000,
  maxEdges: 500,
};

/**
 * Re-applies the panel's configuration. Cheap; called before every render, so
 * anything else that touched the shared Mermaid instance (the Excalidraw
 * converter re-initialises it with its own settings) cannot leak into the panel.
 */
export function configureMermaid(): void {
  mermaid.initialize(MERMAID_CONFIG);
}

let counter = 0;

/** Renders one diagram to an SVG string, or throws when Mermaid cannot parse it. */
export async function renderDiagram(text: string): Promise<string> {
  configureMermaid();
  counter += 1;
  const { svg } = await mermaid.render(`flow-diagram-${counter}`, text);
  return svg;
}
