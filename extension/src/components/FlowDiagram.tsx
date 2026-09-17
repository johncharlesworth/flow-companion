import type { CustomRendererProps } from 'streamdown';
import { createContext, use, useEffect, useRef, useState } from 'react';

import { cleanMermaid } from '@/lib/mermaid-text';

import { Button } from './ui/button';

// Draw this flow, the rendering half. Streamdown
// hands every ```mermaid block to this component through its custom-renderer
// slot. The renderer itself is loaded on first use, so the panel starts without
// it. The SVG Mermaid returns (already sanitised by Mermaid's strict mode) is
// parsed with DOMParser, where scripts can never run, and adopted into an
// element React does not manage; nothing here writes innerHTML (invariant 5
//).

export const DIAGRAM_FAILED = 'Couldn’t draw this one. The text it was working from is below.';

export interface DiagramHandlers {
  /** Re-sends the same turn (a user action, never automatic); absent on answers that are not the last. */
  onTryAgain?: () => void;
  /** Lets the transcript show or hide the diagram bar for this answer. */
  onOutcome?: (outcome: 'rendered' | 'failed') => void;
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
  const { onTryAgain, onOutcome } = use(DiagramContext);
  const text = cleanMermaid(code);
  // The outcome of the last render, keyed by its text; anything else is derived from the cache.
  const [result, setResult] = useState<{ text: string; outcome: Outcome } | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  // The outcome callback belongs to the answer, not to the render: the render effect keys on the text alone.
  const outcomeRef = useRef(onOutcome);
  useEffect(() => {
    outcomeRef.current = onOutcome;
  }, [onOutcome]);

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
          <Button variant="ghost" className="text-accent" onClick={onTryAgain}>
            Try again
          </Button>
        )}
      </div>
    );
  }
  return <div ref={hostRef} className="flow-diagram" role="img" aria-label="Flow diagram" />;
}
