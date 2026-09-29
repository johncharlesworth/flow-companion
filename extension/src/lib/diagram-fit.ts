// How a drawn picture sits in the panel. Mermaid lays a picture out at its own size and the panel
// shrinks it to fit, which is right until the words get too small to read: a picture forty boxes
// wide comes out 21px tall with its words 0.55px high. Pure, so the rule is pinned by the unit
// suite; FlowDiagram applies it.

/** The smallest the panel lets a picture's words get while scrolling sideways can still show them whole. */
export const MIN_LABEL_PX = 11;
/**
 * Past this many panel widths at that size, scrolling sideways stops being reading: a reader sees one
 * corner of a row and takes the picture for broken. Then the whole picture shows, small, and
 * Excalidraw is the place to read it.
 */
export const MAX_PANEL_WIDTHS = 2.5;

export type PictureFit = { kind: 'fits' } | { kind: 'scrolls'; width: number } | { kind: 'tooBig' };

/** `labelPx` is the size Mermaid set the words at, before the panel shrinks the picture. */
export function pictureFit(naturalWidth: number, panelWidth: number, labelPx: number): PictureFit {
  if (!(naturalWidth > 0) || !(panelWidth > 0) || !(labelPx > 0)) return { kind: 'fits' };
  const readableWidth = naturalWidth * (Math.min(MIN_LABEL_PX, labelPx) / labelPx);
  if (readableWidth <= panelWidth) return { kind: 'fits' };
  if (readableWidth <= panelWidth * MAX_PANEL_WIDTHS) return { kind: 'scrolls', width: Math.ceil(readableWidth) };
  return { kind: 'tooBig' };
}
