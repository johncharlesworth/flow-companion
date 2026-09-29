import type { CustomRendererProps } from 'streamdown';
import { createContext, use, useEffect, useRef, useState } from 'react';

import { pictureFit, type PictureFit } from '@/lib/diagram-fit';
import { cleanMermaid } from '@/lib/mermaid-text';

import { Button } from './ui/button';

// Draw this flow, the rendering half. Streamdown
// hands every ```mermaid block to this component through its custom-renderer
// slot. The renderer itself is loaded on first use, so the panel starts without
// it. The SVG Mermaid returns (already sanitised by Mermaid's strict mode) is
// parsed with DOMParser, where scripts can never run, and adopted into an
// element React does not manage; nothing here writes innerHTML (invariant 5).

export const DIAGRAM_FAILED = 'Couldn’t draw this one. The text it was working from is below.';
/** Under a picture too wide to read in the panel, shown whole and small (diagram-fit.ts). */
export const DIAGRAM_TOO_BIG = 'Too big to read here. Open it in Excalidraw to zoom in.';

export interface DiagramHandlers {
  /** Re-sends the same turn (a user action, never automatic); absent on answers that are not the last. */
  onTryAgain?: () => void;
  /** Lets the transcript show or hide the diagram bar for this answer. */
  onOutcome?: (outcome: 'rendered' | 'failed') => void;
  /** The picture changed size after it drew: the transcript checks again whether its bar is in sight. */
  onResize?: () => void;
}

export const DiagramContext = createContext<DiagramHandlers>({});

/** Rendered SVG per cleaned diagram text, so a remount (streaming → static) does not redraw. */
const cache = new Map<string, string>();
const CACHE_MAX = 24;

function remember(text: string, svg: string) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(text, svg);
}

type Outcome = { kind: 'rendered'; svg: string } | { kind: 'failed' };

export function FlowDiagram({ code, isIncomplete }: CustomRendererProps) {
  const { onTryAgain, onOutcome, onResize } = use(DiagramContext);
  const text = cleanMermaid(code);
  // The outcome of the last render, keyed by its text; anything else is derived from the cache.
  const [result, setResult] = useState<{ text: string; outcome: Outcome } | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<PictureFit['kind']>('fits');
  // Which sides of a scrolling picture have more of it: the fade sits only on those.
  const [edge, setEdge] = useState<'start' | 'middle' | 'end'>('middle');
  // The outcome callback belongs to the answer, not to the render: the render effect keys on the text alone.
  const outcomeRef = useRef(onOutcome);
  const resizeRef = useRef(onResize);
  useEffect(() => {
    outcomeRef.current = onOutcome;
    resizeRef.current = onResize;
  }, [onOutcome, onResize]);

  const cached = cache.get(text);
  const outcome: Outcome | null = result?.text === text ? result.outcome : cached ? { kind: 'rendered', svg: cached } : null;
  const svg = outcome?.kind === 'rendered' ? outcome.svg : null;

  useEffect(() => {
    if (isIncomplete) return;
    if (cache.has(text)) {
      outcomeRef.current?.('rendered');
      return;
    }
    let live = true;
    void import('@/lib/mermaid-render.lazy')
      .then(({ renderDiagram }) => renderDiagram(text))
      .then((rendered) => {
        if (!live) return;
        remember(text, rendered);
        setResult({ text, outcome: { kind: 'rendered', svg: rendered } });
        outcomeRef.current?.('rendered');
      })
      .catch(() => {
        if (!live) return;
        setResult({ text, outcome: { kind: 'failed' } });
        outcomeRef.current?.('failed');
      });
    return () => {
      live = false;
    };
  }, [text, isIncomplete]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || svg === null) return;
    // DOMParser output is inert: a <script> parsed here never runs, even once adopted. Strict-mode Mermaid
    // emits none; any that slipped through is removed anyway.
    const parsed = new DOMParser().parseFromString(svg, 'text/html').body.querySelector('svg');
    parsed?.querySelectorAll('script').forEach((node) => node.remove());
    el.replaceChildren(...(parsed ? [document.adoptNode(parsed)] : []));
    const picture = el.querySelector('svg');
    if (!picture) return;
    // Mermaid's own max-width (the picture's natural width), put back whenever the picture fits again.
    const naturalMaxWidth = picture.style.maxWidth;
    let centred = false;
    let placed: PictureFit['kind'] | null = null;
    // The picture's size, on the page only. Done at once, here, so a picture already has its final height when the
    // transcript decides where to scroll: done later, the picture would get taller after the answer's last scroll and leave Open
    // in Excalidraw out of sight with no "Jump to latest".
    const size = () => {
      const label = picture.querySelector('text');
      const next = pictureFit(picture.viewBox.baseVal.width, el.clientWidth, label ? parseFloat(getComputedStyle(label).fontSize) : Number.NaN);
      picture.style.minWidth = next.kind === 'scrolls' ? `${next.width}px` : '';
      picture.style.maxWidth = next.kind === 'scrolls' ? 'none' : naturalMaxWidth;
      // A wide picture opens on its middle, where a top-down layout puts the element everything runs into, rather than on one corner of a row.
      if (next.kind === 'scrolls' && !centred) {
        el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
        centred = true;
      }
      if (next.kind !== 'scrolls') centred = false;
      return next.kind;
    };
    const onEdges = () => setEdge(el.scrollLeft <= 1 ? 'start' : el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 ? 'end' : 'middle');
    size();
    // The observer's first call, on observing, sets what the page shows beside the size (the fades, the "too big" line);
    // later ones follow the panel's width. Any change of fit tells the transcript, which checks its bar is still in sight.
    const observer = new ResizeObserver(() => {
      const kind = size();
      setFit(kind);
      onEdges();
      if (placed !== null && placed !== kind) resizeRef.current?.();
      if (placed === null && kind === 'tooBig') resizeRef.current?.();
      placed = kind;
    });
    observer.observe(el);
    el.addEventListener('scroll', onEdges, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', onEdges);
    };
  }, [svg]);

  if (isIncomplete || outcome === null) {
    return (
      <pre className="flow-diagram-source" aria-busy={!isIncomplete}>
        <code>{code}</code>
      </pre>
    );
  }
  if (outcome.kind === 'failed') {
    return (
      <div className="flow-diagram-failed" role="group" aria-label="Diagram could not be drawn">
        <p className="text-xs text-text-3">{DIAGRAM_FAILED}</p>
        <pre>
          <code>{code}</code>
        </pre>
        {onTryAgain && (
          <Button variant="link" onClick={onTryAgain}>
            Try again
          </Button>
        )}
      </div>
    );
  }
  return (
    <>
      <div ref={hostRef} className="flow-diagram" role="img" aria-label="Flow diagram" data-fit={fit} data-edge={fit === 'scrolls' ? edge : undefined} />
      {fit === 'tooBig' && <p className="flow-diagram-too-big text-xs text-text-3">{DIAGRAM_TOO_BIG}</p>}
    </>
  );
}
