import { ArrowDown, Check, Copy, Download, ExternalLink, Waypoints } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { ChatTurn } from '@/hooks/useChatStream';
import { type ChatErrorAction, chatErrorCopy, FOOTER } from '@/lib/chat-errors';
import { cn } from '@/lib/cn';
import { copyDiagramForExcalidraw, EXCALIDRAW_URL, excalidrawHint, excalidrawInstruction, type ExcalidrawRoute, MERMAID_COPY_LINK, MERMAID_COPY_TAIL } from '@/lib/excalidraw-export';
import { checkIdentifiers, cleanMermaid, extractMermaid } from '@/lib/mermaid-text';
import type { ChatMode, DrawVariant } from '@/lib/modes';
import { type ProviderId, providerName } from '@/lib/models';

import { Chip } from './Chip';
import type { DiagramHandlers } from './FlowDiagram';
import { NoticeRow } from './NoticeRow';
import { SanitizedMarkdown } from './SanitizedMarkdown';
import { Button } from './ui/button';
import { Tip } from './ui/tooltip';

// Draw this flow, under every rendered diagram.
export const DIAGRAM_FOOTER = (provider: string, variant?: DrawVariant) =>
  `${variant === 'admins' ? 'Drawn' : 'A simplified picture, drawn'} by ${provider} from the saved version. Check the details in Flow Builder before you rely on it.`;
export const UNKNOWN_NAMES = (names: string[]) => `Names not in this flow: ${names.join(', ')}.`;
/** The follow-up chips: the verb says they draw again (a real-Chrome check). */
export const DRAW_CHIP = { admins: 'Draw every element', fromElement: 'Draw one element…' } as const;

export interface TranscriptProps {
  turns: ChatTurn[];
  status: 'idle' | 'waiting' | 'streaming';
  provider: ProviderId;
  /** Names for the "too big" copy. */
  currentModelLabel: string;
  suggestedModelLabel?: string | null;
  onRetry: () => void;
  onContinue: () => void;
  onErrorAction: (action: ChatErrorAction) => void;
  onDownloadDocument: (markdown: string) => void;
  /** Try again under a diagram that would not draw: re-sends the last question. */
  onRedo: () => void;
  /** The follow-up chips under a drawn diagram; without it the chips are not shown. */
  onDrawFollowUp?: (variant: keyof typeof DRAW_CHIP) => void;
  /** The flow's saved metadata, for the "names not in this flow" note. */
  flowMetadata: unknown;
}

const MODE_PILL: Record<string, string> = { overview: 'Overview', explain: 'Explain', document: 'Document', draw: 'Draw' };

export function Transcript({ turns, status, provider, currentModelLabel, suggestedModelLabel, onRetry, onContinue, onErrorAction, onDownloadDocument, onRedo, onDrawFollowUp, flowMetadata }: TranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  // Whether each draw answer's diagram rendered; the bar and chips wait for it.
  const [drawn, setDrawn] = useState<Record<string, 'rendered' | 'failed'>>({});
  const lastAnswer = turns.filter((t) => t.role === 'assistant').at(-1);
  const lastText = lastAnswer?.displayText ?? '';

  // Auto-scroll while the reader is at the bottom; otherwise offer "Jump to latest".
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (atBottom) el.scrollTop = el.scrollHeight;
  }, [turns, lastText, status, atBottom]);

  const announce = status === 'idle' && lastAnswer && !lastAnswer.interrupted && lastAnswer.displayText ? 'Answer finished' : '';

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-3" role="log" aria-label="Conversation">
        {turns.map((turn, index) => {
          if (turn.role === 'notice') return <NoticeRow key={turn.id}>{turn.displayText}</NoticeRow>;
          if (turn.role === 'user') return <UserBubble key={turn.id} turn={turn} />;
          const isLast = index === turns.length - 1;
          const streaming = isLast && status === 'streaming';
          const question = turns[index - 1];
          const isDocument = question?.role === 'user' && question.mode === 'document';
          // Any answer with a diagram gets the footer, the bar, and the chips, whether it came from the Draw button or a typed request.
          const drawQuestion = question?.role === 'user' && question.mode === 'draw' ? question : null;
          const mermaid = !streaming ? extractMermaid(turn.displayText) : null;
          const diagram: DiagramHandlers = {
            onOutcome: (outcome) => setDrawn((prev) => (prev[turn.id] === outcome ? prev : { ...prev, [turn.id]: outcome })),
            onTryAgain: isLast && status === 'idle' ? onRedo : undefined,
          };
          return (
            <div key={turn.id} className="mb-4">
              {isLast && status === 'waiting' && <Waiting mode={question?.role === 'user' ? question.mode : undefined} />}
              {turn.displayText && <SanitizedMarkdown markdown={turn.displayText} streaming={streaming} diagram={diagram} />}
              {mermaid && drawn[turn.id] === 'rendered' && (
                <DiagramBar text={cleanMermaid(mermaid)} provider={providerName(provider)} flowMetadata={flowMetadata} variant={drawQuestion?.variant} onFollowUp={onDrawFollowUp} />
              )}
              {!streaming && !(isLast && status === 'waiting') && (
                <AnswerFooter turn={turn} provider={provider} currentModelLabel={currentModelLabel} suggestedModelLabel={suggestedModelLabel} onRetry={onRetry} onContinue={onContinue} onErrorAction={onErrorAction} />
              )}
              {!streaming && isDocument && turn.stopReason && turn.displayText && <DocumentBar markdown={turn.displayText} onDownload={() => onDownloadDocument(turn.displayText)} />}
              {turn.reread && !streaming && <NoticeRow>{`${providerName(provider)} re-read the whole flow for that question, so it cost more. Follow-ups reuse it again.`}</NoticeRow>}
            </div>
          );
        })}
      </div>
      {!atBottom && (
        <button
          type="button"
          onClick={() => {
            setAtBottom(true);
            const el = scrollRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
          className="absolute bottom-2 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-pill bg-surface-elevated px-3 py-1 text-xs text-text-1 shadow-elevated"
        >
          <ArrowDown className="h-3 w-3" aria-hidden="true" /> Jump to latest
        </button>
      )}
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
    </div>
  );
}

function UserBubble({ turn }: { turn: ChatTurn }) {
  const pill = turn.mode && turn.mode !== 'ask' ? MODE_PILL[turn.mode] : null;
  return (
    <div className="mb-4 flex justify-end">
      <div className="max-w-[62ch] rounded-composer bg-surface px-3 py-2 text-[14px] text-text-1">
        {(pill || turn.focusElement) && (
          <span className="mb-1 flex flex-wrap items-center gap-1.5">
            {pill && <span className="rounded-pill bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-fg">{pill}</span>}
            {turn.focusElement && <span className="rounded-pill border border-hairline px-2 py-0.5 font-mono text-[11px] text-text-2">{turn.focusElement}</span>}
          </span>
        )}
        {turn.displayText && <span className="whitespace-pre-wrap">{turn.displayText}</span>}
      </div>
    </div>
  );
}

/**
 * Before the first token. A draw or a document says so, and after 20 seconds
 * says how long it can take (a real-Chrome check: 45
 * quiet seconds before a picture, and two minutes before a document, read as
 * a bug without a word about it).
 */
export const WAITING = {
  thinking: 'Thinking…',
  drawing: 'Drawing…',
  writing: 'Writing the document…',
  longAnswer: 'Thorough answers on this model can take a minute',
  longDrawing: 'Drawing a whole flow can take a minute or two.',
  longWriting: 'A full document of a large flow can take a couple of minutes.',
} as const;

function Waiting({ mode }: { mode?: ChatMode }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  const label = mode === 'draw' ? WAITING.drawing : mode === 'document' ? WAITING.writing : WAITING.thinking;
  const long = mode === 'draw' ? WAITING.longDrawing : mode === 'document' ? WAITING.longWriting : WAITING.longAnswer;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[14px] text-text-2" role="status">
      <span className="flex gap-1" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-1.5 w-1.5 rounded-full bg-text-3 motion-safe:animate-pulse" style={{ animationDelay: `${i * 150}ms` }} />
        ))}
      </span>
      <span>{seconds >= 4 ? `${label} ${seconds}s` : label}</span>
      {seconds >= 20 && <span className="text-xs text-text-2">{long}</span>}
    </div>
  );
}

function AnswerFooter({ turn, provider, currentModelLabel, suggestedModelLabel, onRetry, onContinue, onErrorAction }: { turn: ChatTurn; provider: ProviderId; currentModelLabel: string; suggestedModelLabel?: string | null; onRetry: () => void; onContinue: () => void; onErrorAction: (a: ChatErrorAction) => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(turn.displayText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      /* clipboard unavailable */
    }
  };
  let label: string | null = null;
  if (turn.interrupted === 'stopped') label = turn.displayText ? FOOTER.stopped : FOOTER.stoppedEmpty;
  else if (turn.interrupted === 'error') label = FOOTER.interrupted;
  else if (turn.stopReason === 'max_tokens') label = FOOTER.cutOff;
  else if (turn.stopReason === 'refusal') label = FOOTER.declined;
  const error = turn.interrupted === 'error' && turn.error ? chatErrorCopy(turn.error.class, provider, { tooBigFor: currentModelLabel, fits: suggestedModelLabel ?? null }) : null;
  // A hydrated interrupted answer (panel closed or tab switched mid-stream) has no
  // error class, so the footer carries Retry; when a class is known, its card does.
  const showRetry = turn.interrupted === 'error' && !error;

  return (
    <div className="mt-1 flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs text-text-3">
        {turn.displayText && (
          <Tip content={copied ? 'Copied' : 'Copy answer'}>
            <button type="button" onClick={() => void copy()} aria-label="Copy answer" className="inline-flex h-6 w-6 items-center justify-center rounded-button opacity-60 hover:bg-accent-subtle hover:opacity-100 focus-visible:opacity-100">
              {copied ? <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
            </button>
          </Tip>
        )}
        {label && <span>{label}</span>}
        {showRetry && <FooterLink onClick={onRetry}>Retry</FooterLink>}
        {turn.stopReason === 'max_tokens' && <FooterLink onClick={onContinue}>Continue</FooterLink>}
      </div>
      {error && (
        <div className="rounded-composer bg-surface px-3 py-2 text-[14px]" role="alert">
          <p className="font-medium text-text-1">{error.title}</p>
          <p className="text-text-2">{error.body}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {error.actions.map((action) => (
              <Button key={action} variant={action === 'retry' || action === 'switchModel' ? 'primary' : 'ghost'} className={cn(action !== 'retry' && action !== 'switchModel' && 'text-accent')} onClick={() => (action === 'retry' ? onRetry() : onErrorAction(action))}>
                {ACTION_LABEL(action, provider, suggestedModelLabel)}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ACTION_LABEL(action: ChatErrorAction, provider: ProviderId, suggested?: string | null): string {
  switch (action) {
    case 'retry':
      return 'Retry';
    case 'openSettings':
      return 'Open Settings';
    case 'openBilling':
      return 'Open billing';
    case 'openProviderSite':
      return `Open ${providerName(provider)}’s site`;
    case 'openModelMenu':
      return 'Open model menu';
    case 'switchModel':
      return suggested ? `Switch to ${suggested}` : 'Switch model';
    case 'none':
      return '';
  }
}

function FooterLink({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <>
      <span aria-hidden="true">·</span>
      <button type="button" onClick={onClick} className="text-accent underline-offset-2 hover:underline">
        {children}
      </button>
    </>
  );
}

function DocumentBar({ markdown, onDownload }: { markdown: string; onDownload: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex items-center gap-2 rounded-composer bg-surface px-3 py-2">
      <Button
        onClick={() => {
          void navigator.clipboard.writeText(markdown).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1_500);
          });
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
      <Tip content="Saves as a plain-text file most wikis accept">
        <Button variant="ghost" onClick={onDownload}>
          <Download className="h-4 w-4" aria-hidden="true" /> Download
        </Button>
      </Tip>
    </div>
  );
}

/** Footer, Open in Excalidraw with its one line, and the two follow-up chips under a rendered diagram (the chips only when there is somewhere to send them). */
function DiagramBar({ text, provider, flowMetadata, variant, onFollowUp }: { text: string; provider: string; flowMetadata: unknown; variant?: DrawVariant; onFollowUp?: (variant: keyof typeof DRAW_CHIP) => void }) {
  const [hint, setHint] = useState<ExcalidrawRoute | null>(null);
  const [opening, setOpening] = useState(false);
  const [copied, setCopied] = useState(false);
  const { unknown } = checkIdentifiers(text, flowMetadata);
  const copyMermaid = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      /* clipboard unavailable */
    }
  };
  const openInExcalidraw = async () => {
    setOpening(true);
    try {
      // The clipboard first: it belongs to the focused document, and the new tab takes the focus.
      const route = await copyDiagramForExcalidraw(text);
      window.open(EXCALIDRAW_URL, '_blank', 'noopener');
      setHint(route);
    } catch {
      /* clipboard unavailable */
    } finally {
      setOpening(false);
    }
  };
  return (
    <div className="mt-2 flex flex-col gap-2">
      <p className="text-xs text-text-3">
        {DIAGRAM_FOOTER(provider, variant)}
        {unknown.length > 0 && <> {UNKNOWN_NAMES(unknown)}</>}
      </p>
      <div className="flex flex-wrap items-center gap-2 rounded-composer bg-surface px-3 py-2">
        <Button onClick={() => void openInExcalidraw()} disabled={opening}>
          <ExternalLink className="h-4 w-4" aria-hidden="true" /> Open in Excalidraw
        </Button>
        <span className="basis-full text-[13px] text-text-2">
          {excalidrawInstruction()} Or{' '}
          <button type="button" onClick={() => void copyMermaid()} className="text-accent underline-offset-2 hover:underline">
            {copied ? 'copied' : MERMAID_COPY_LINK}
          </button>
          {MERMAID_COPY_TAIL}
        </span>
        {hint && (
          <span className="basis-full text-xs text-text-3" role="status">
            {excalidrawHint(hint)}
          </span>
        )}
      </div>
      {onFollowUp && (
        <div className="flex flex-wrap gap-2">
          {variant !== 'admins' && (
            <Chip icon={<Waypoints className="h-4 w-4 text-accent" aria-hidden="true" />} onClick={() => onFollowUp('admins')}>
              {DRAW_CHIP.admins}
            </Chip>
          )}
          <Chip icon={<Waypoints className="h-4 w-4 text-accent" aria-hidden="true" />} onClick={() => onFollowUp('fromElement')}>
            {DRAW_CHIP.fromElement}
          </Chip>
        </div>
      )}
    </div>
  );
}
