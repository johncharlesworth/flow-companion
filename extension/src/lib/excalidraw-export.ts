// Open in Excalidraw. Route (a): the diagram
// goes to the clipboard as Excalidraw elements, so one paste on the canvas
// places editable shapes. If the converter cannot handle the diagram, route
// (b): the Mermaid text is copied instead and the hint names Excalidraw's own
// Mermaid import. The clipboard is written before the tab opens, because the
// clipboard belongs to the focused document and the new tab takes the focus.

export const EXCALIDRAW_URL = 'https://excalidraw.com/';

export type ExcalidrawRoute = 'elements' | 'text';

/** The paste shortcut for this computer: ⌘V on a Mac, Ctrl+V elsewhere. */
export function pasteKey(userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): '⌘V' | 'Ctrl+V' {
  return /Mac|iPhone|iPad/.test(userAgent) ? '⌘V' : 'Ctrl+V';
}

/** Always visible in the diagram bar, before the click (a real-Chrome check: the shortcut was not obvious). */
export const excalidrawInstruction = (key = pasteKey()) => `Opens excalidraw.com in a new tab with the picture on your clipboard. Paste it there with ${key} to edit it.`;
/** The quiet alternative at the end of that line, for people who know Mermaid: a link, never a second button. */
export const MERMAID_COPY_LINK = 'copy the Mermaid text';
export const MERMAID_COPY_TAIL = ' to use it elsewhere.';

/** After the click, where the bar is still on screen (the demo tab). */
export const excalidrawHint = (route: ExcalidrawRoute, key = pasteKey()) =>
  route === 'elements' ? `Copied. Press ${key} on the Excalidraw canvas.` : 'Copied. In Excalidraw, choose More tools → Mermaid to Excalidraw, then paste.';

/**
 * The side panel follows the active tab, so the moment excalidraw.com opens the
 * panel shows its "Not on Salesforce" state, not the diagram bar. That state
 * carries this line while an export is pending.
 */
export const excalidrawPendingNote = (route: ExcalidrawRoute, key = pasteKey()) =>
  route === 'elements'
    ? `Your diagram is on the clipboard. Press ${key} on the Excalidraw canvas, then come back to your Flow tab to keep chatting.`
    : 'Your diagram’s Mermaid text is on the clipboard. In Excalidraw, choose More tools → Mermaid to Excalidraw and paste it, then come back to your Flow tab to keep chatting.';

const PENDING_MS = 10 * 60_000;
let pending: { route: ExcalidrawRoute; since: number } | null = null;

/** The route of an export made in the last ten minutes and not yet followed by a return to a flow, else null. */
export function excalidrawPending(now = Date.now()): ExcalidrawRoute | null {
  return pending && now - pending.since < PENDING_MS ? pending.route : null;
}

/** Called when a flow is shown again: the user is back, the note has done its job. */
export function clearExcalidrawPending(): void {
  pending = null;
}

type Loader = () => Promise<{ toExcalidrawClipboard: (text: string) => Promise<string> }>;

/** Writes the diagram to the clipboard for Excalidraw and says which route it took. */
export async function copyDiagramForExcalidraw(text: string, load: Loader = () => import('./excalidraw-export.lazy')): Promise<ExcalidrawRoute> {
  let payload = text;
  let route: ExcalidrawRoute = 'text';
  try {
    payload = await (await load()).toExcalidrawClipboard(text);
    route = 'elements';
  } catch {
    /* the converter could not handle this diagram: Excalidraw's own Mermaid import can */
  }
  await navigator.clipboard.writeText(payload);
  pending = { route, since: Date.now() };
  return route;
}
