import { describe, expect, it, vi } from 'vitest';

// The lazy half, with the converter and the renderer's configure scripted: the
// payload carries Excalidraw's API clipboard type, and the panel's Mermaid
// settings are restored afterwards whether or not the conversion worked.

const parse = vi.fn();
vi.mock('@excalidraw/mermaid-to-excalidraw', () => ({ parseMermaidToExcalidraw: (...args: unknown[]) => parse(...args) }));
const configureMermaid = vi.fn();
vi.mock('./mermaid-render.lazy', () => ({ configureMermaid: () => configureMermaid() }));

import { EXCALIDRAW_CLIPBOARD_TYPE, toExcalidrawClipboard } from './excalidraw-export.lazy';

describe('toExcalidrawClipboard', () => {
  it('wraps the converter’s skeleton elements in the API clipboard type and restores the renderer’s config', async () => {
    parse.mockResolvedValueOnce({ elements: [{ type: 'rectangle', x: 0, y: 0 }], files: undefined });
    const json = JSON.parse(await toExcalidrawClipboard('flowchart TD\n  A --> B')) as { type: string; elements: unknown[]; files?: unknown };
    expect(json.type).toBe(EXCALIDRAW_CLIPBOARD_TYPE);
    expect(EXCALIDRAW_CLIPBOARD_TYPE).toBe('excalidraw-api/clipboard');
    expect(json.elements).toHaveLength(1);
    expect('files' in json).toBe(false);
    expect(parse.mock.calls[0]?.[1]).toMatchObject({ flowchart: { curve: 'linear' }, maxTextSize: 50_000 });
    expect(configureMermaid).toHaveBeenCalledOnce();
  });

  it('keeps files when the converter produced an image fallback, and restores the config even on failure', async () => {
    parse.mockResolvedValueOnce({ elements: [], files: { f1: { id: 'f1' } } });
    expect(JSON.parse(await toExcalidrawClipboard('x')) as object).toHaveProperty('files');
    parse.mockRejectedValueOnce(new Error('nope'));
    await expect(toExcalidrawClipboard('y')).rejects.toThrow('nope');
    expect(configureMermaid).toHaveBeenCalledTimes(3);
  });
});
