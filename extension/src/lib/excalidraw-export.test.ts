import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearExcalidrawPending, copyDiagramForExcalidraw, EXCALIDRAW_URL, excalidrawHint, excalidrawInstruction, excalidrawPending, excalidrawPendingNote, pasteKey } from './excalidraw-export';

// Open in Excalidraw: elements on the clipboard when
// the converter succeeds, the Mermaid text when it does not; never a share link.

const DIAGRAM = 'flowchart TD\n  A["Start"] --> B["End"]';

describe('copyDiagramForExcalidraw', () => {
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  afterEach(() => writeText.mockClear());

  it('route (a): writes the converter’s clipboard JSON and reports elements', async () => {
    const load = vi.fn(async () => ({ toExcalidrawClipboard: async (text: string) => JSON.stringify({ type: 'excalidraw-api/clipboard', elements: [{ type: 'rectangle', text }] }) }));
    const route = await copyDiagramForExcalidraw(DIAGRAM, load);
    expect(route).toBe('elements');
    expect(load).toHaveBeenCalledOnce();
    const written = JSON.parse(writeText.mock.calls[0]?.[0] as unknown as string) as { type: string; elements: unknown[] };
    expect(written.type).toBe('excalidraw-api/clipboard');
    expect(written.elements).toHaveLength(1);
    expect(excalidrawHint('elements', '⌘V')).toBe('Copied. Press ⌘V on the Excalidraw canvas.');
  });

  it('route (b): when the converter fails, the Mermaid text itself is copied and the hint names Excalidraw’s import', async () => {
    const load = vi.fn(async () => ({
      toExcalidrawClipboard: async () => {
        throw new Error('unsupported');
      },
    }));
    const route = await copyDiagramForExcalidraw(DIAGRAM, load);
    expect(route).toBe('text');
    expect(writeText).toHaveBeenCalledWith(DIAGRAM);
    expect(excalidrawHint('text')).toBe('Copied. In Excalidraw, choose More tools → Mermaid to Excalidraw, then paste.');
  });

  it('a failing chunk load also falls back to the text', async () => {
    const route = await copyDiagramForExcalidraw(DIAGRAM, async () => {
      throw new Error('offline');
    });
    expect(route).toBe('text');
    expect(writeText).toHaveBeenCalledWith(DIAGRAM);
  });

  it('the destination is excalidraw.com with nothing in the URL', () => {
    expect(EXCALIDRAW_URL).toBe('https://excalidraw.com/');
  });

  it('the paste shortcut follows the computer, and every instruction uses it', () => {
    expect(pasteKey('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140')).toBe('⌘V');
    expect(pasteKey('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140')).toBe('Ctrl+V');
    expect(pasteKey('Mozilla/5.0 (X11; Linux x86_64) Chrome/140')).toBe('Ctrl+V');
    expect(excalidrawInstruction('Ctrl+V')).toBe('Opens excalidraw.com in a new tab with the picture on your clipboard. Paste it there with Ctrl+V to edit it.');
    expect(excalidrawPendingNote('elements', 'Ctrl+V')).toBe('Your diagram is on the clipboard. Press Ctrl+V on the Excalidraw canvas, then come back to your Flow tab to keep chatting.');
    expect(excalidrawPendingNote('text')).toMatch(/More tools → Mermaid to Excalidraw/);
  });

  it('remembers the export as pending for ten minutes, or until a flow is shown again', async () => {
    clearExcalidrawPending();
    expect(excalidrawPending()).toBeNull();
    const started = Date.now();
    await copyDiagramForExcalidraw(DIAGRAM, async () => ({ toExcalidrawClipboard: async () => '{}' }));
    expect(excalidrawPending()).toBe('elements');
    expect(excalidrawPending(started + 9 * 60_000)).toBe('elements');
    expect(excalidrawPending(started + 11 * 60_000)).toBeNull();
    clearExcalidrawPending();
    expect(excalidrawPending()).toBeNull();
    await copyDiagramForExcalidraw(DIAGRAM, async () => {
      throw new Error('offline');
    });
    expect(excalidrawPending()).toBe('text');
    clearExcalidrawPending();
  });
});
