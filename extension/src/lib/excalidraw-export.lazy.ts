// Open in Excalidraw, route (a) of the diagram is
// converted to Excalidraw's element skeletons inside the extension and written
// to the clipboard in Excalidraw's own paste format, so one paste on the
// excalidraw.com canvas places editable shapes. Nothing is uploaded and no
// share link is made: the flow text never travels to a third host on its own.
// Loaded on demand; it shares the Mermaid chunk with the renderer.

import { parseMermaidToExcalidraw } from '@excalidraw/mermaid-to-excalidraw';

import { configureMermaid } from './mermaid-render.lazy';

/**
 * Excalidraw's clipboard type for skeleton elements: its paste handler runs
 * them through convertToExcalidrawElements itself (excalidraw/excalidraw,
 * `EXPORT_DATA_TYPES.excalidrawClipboardWithAPI`, checked against 0.18.1).
 */
export const EXCALIDRAW_CLIPBOARD_TYPE = 'excalidraw-api/clipboard';

export async function toExcalidrawClipboard(text: string): Promise<string> {
  try {
    const { elements, files } = await parseMermaidToExcalidraw(text, { flowchart: { curve: 'linear' }, themeVariables: { fontSize: '16px' }, maxTextSize: 50_000, maxEdges: 500 });
    return JSON.stringify({ type: EXCALIDRAW_CLIPBOARD_TYPE, elements, ...(files ? { files } : {}) });
  } finally {
    // The converter re-initialises the shared Mermaid instance with its own settings; the panel's come back.
    configureMermaid();
  }
}
