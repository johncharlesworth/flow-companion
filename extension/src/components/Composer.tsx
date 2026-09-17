import { Menu } from '@base-ui/react/menu';
import { Popover } from '@base-ui/react/popover';
import { FileText, ListTree, MessageSquareText, Send, Sparkles, Square, Waypoints, Workflow, X } from 'lucide-react';
import { Fragment, type KeyboardEvent, type ReactElement, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';
import type { ChatMode } from '@/lib/modes';
import { STARTER_QUESTIONS } from '@/lib/modes';

import { Button } from './ui/button';
import { Tip } from './ui/tooltip';

export interface ComposerProps {
  flowLabel: string;
  /** The flow chip: one plain sentence (the consequence), a one-line hover summary after an answer (null before), and the card's rows (zeros before). */
  chipStory: string;
  chipSummary?: string | null;
  chipRows: [label: string, value: string][];
  element: { name: string; label: string } | null;
  onRemoveElement: () => void;
  /** The model chip, already wrapped in its menu. */
  modelChip: ReactElement;
  busy: boolean;
  disabled?: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onQuickAction: (mode: Exclude<ChatMode, 'ask'>) => void;
  /** Opens the element picker with the draw intent (the picture around one element). */
  onDrawFromElement: () => void;
  onStarter: (question: string) => void;
  blocked: { message: string; switchLabel?: string; onSwitch?: () => void } | null;
  nudge: boolean;
  onNewChat: () => void;
  onDismissNudge: () => void;
}

const MAX_LINES = 6;

export function Composer({ flowLabel, chipStory, chipSummary, chipRows, element, onRemoveElement, modelChip, busy, disabled = false, onSend, onStop, onQuickAction, onDrawFromElement, onStarter, blocked, nudge, onNewChat, onDismissNudge }: ComposerProps) {
  const [text, setText] = useState('');
  const [hint, setHint] = useState<'unseen' | 'showing' | 'seen'>('unseen');
  // The flow chip: hover peeks at its story, a click pins it.
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const line = parseFloat(getComputedStyle(el).lineHeight) || 22;
    el.style.height = `${Math.min(el.scrollHeight, line * MAX_LINES + 16)}px`;
  }, [text]);

  useEffect(() => {
    if (element) ref.current?.focus();
  }, [element]);

  const submit = () => {
    if (busy || disabled || blocked) return;
    const trimmed = text.trim();
    if (!trimmed && !element) return;
    onSend(trimmed);
    setText('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const placeholder = element ? `Press Enter to explain ${element.name}, or ask something about it` : 'Ask about this flow…';
  const canSend = !disabled && !busy && !blocked && (text.trim().length > 0 || element !== null);

  // Hover: one line. Click: the breakdown.
  const chipHover = chipSummary ?? chipStory;
  const flowChip = (
    <Popover.Trigger
      render={<button type="button" aria-label={`About this flow: ${flowLabel}`} className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-pill border border-hairline bg-surface px-2 text-xs text-text-2 transition-colors hover:bg-accent-subtle data-[popup-open]:bg-accent-subtle" />}
    >
      <Workflow className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
      <span className="truncate text-text-1">{flowLabel}</span>
    </Popover.Trigger>
  );

  return (
    <div className="shrink-0 px-3 pb-3">
      {nudge && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-composer bg-surface px-3 py-2 text-[14px] text-text-1" role="status">
          <span className="flex-1">This chat is getting long. Start a new chat to keep answers quick. The flow stays attached.</span>
          <Button onClick={onNewChat}>New chat</Button>
          <Button variant="ghost" onClick={onDismissNudge}>
            Not now
          </Button>
        </div>
      )}
      <div className="rounded-composer border border-hairline bg-composer">
        <div className="flex flex-wrap items-center gap-2 px-3 pt-2">
          <Popover.Root open={pinned} onOpenChange={setPinned}>
            {/* One stable chip: the tooltip goes quiet while pinned, so the popover keeps its anchor. */}
            <Tip content={chipHover} side="top" disabled={pinned}>
              {flowChip}
            </Tip>
            <Popover.Portal>
              <Popover.Positioner side="top" align="start" sideOffset={6} className="z-50">
                <Popover.Popup className="flex w-[min(300px,calc(100vw-24px))] flex-col gap-2 rounded-popover bg-surface-elevated px-3 py-2.5 text-xs leading-[1.45] text-text-1 shadow-elevated outline-none">
                  <span className="font-medium text-text-2">{chipSummary ? 'Last question' : 'No questions yet'}</span>
                  <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                    {chipRows.map(([label, value]) => (
                      <Fragment key={label}>
                        <dt className="text-text-2">{label}</dt>
                        <dd className="text-right font-mono text-text-1">{value}</dd>
                      </Fragment>
                    ))}
                  </dl>
                  <span className="border-t border-hairline pt-2 text-text-3">{chipStory}</span>
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
          {element && (
            <span className="inline-flex h-7 items-center gap-1.5 rounded-pill border border-hairline bg-surface pl-2 pr-1 font-mono text-xs text-text-1">
              <ListTree className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
              {element.name}
              <button type="button" aria-label={`Remove ${element.name}`} onClick={onRemoveElement} className="rounded-full p-0.5 text-text-3 hover:bg-accent-subtle hover:text-text-1">
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          )}
        </div>
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setHint((h) => (h === 'unseen' ? 'showing' : h))}
          onBlur={() => setHint('seen')}
          placeholder={placeholder}
          aria-label="Message"
          rows={1}
          disabled={disabled}
          className="block w-full resize-none bg-transparent px-3 py-2 text-[14px] leading-[1.55] text-text-1 outline-none placeholder:text-text-3 disabled:opacity-60"
        />
        {blocked && (
          <div className="mx-3 mb-2 flex flex-wrap items-center gap-2 rounded-button bg-bg px-2 py-1.5 text-xs text-text-1" role="status">
            <span className="flex-1">{blocked.message}</span>
            {blocked.switchLabel && blocked.onSwitch && (
              <button type="button" onClick={blocked.onSwitch} className="rounded-button bg-accent px-2 py-1 text-xs font-medium text-accent-fg">
                {blocked.switchLabel}
              </button>
            )}
          </div>
        )}
        <div className="flex items-center gap-1 px-2 pb-2">
          {modelChip}
          <Menu.Root>
            <Tip content="Overview, explain an element, document, draw" side="top">
              <Menu.Trigger
                render={
                  <Button variant="ghost" size="icon" aria-label="Quick actions" disabled={disabled}>
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                  </Button>
                }
              />
            </Tip>
            <Menu.Portal>
              <Menu.Positioner side="top" align="start" sideOffset={6} className="z-50">
                <Menu.Popup className="min-w-[220px] rounded-popover bg-surface-elevated p-1 shadow-elevated outline-none">
                  <QuickItem icon={<Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />} label="Overview" onClick={() => onQuickAction('overview')} />
                  <QuickItem icon={<ListTree className="h-4 w-4 text-accent" aria-hidden="true" />} label="Explain an element" onClick={() => onQuickAction('explain')} />
                  <QuickItem icon={<FileText className="h-4 w-4 text-accent" aria-hidden="true" />} label="Document this flow" onClick={() => onQuickAction('document')} />
                  <QuickItem icon={<Waypoints className="h-4 w-4 text-accent" aria-hidden="true" />} label={element ? `Draw ${element.name}` : 'Draw this flow'} onClick={() => onQuickAction('draw')} />
                  {!element && <QuickItem icon={<Waypoints className="h-4 w-4 text-accent" aria-hidden="true" />} label="Draw one element…" onClick={onDrawFromElement} />}
                  <Menu.Separator className="my-1 h-px bg-hairline" />
                  {STARTER_QUESTIONS.map((q) => (
                    <QuickItem key={q} icon={<MessageSquareText className="h-4 w-4 text-text-3" aria-hidden="true" />} label={q} onClick={() => onStarter(q)} />
                  ))}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
          <span className={cn('flex-1 text-[11px] text-text-3 transition-opacity', hint === 'showing' ? 'opacity-100' : 'opacity-0')} aria-hidden={hint !== 'showing'}>
            Enter to send · Shift+Enter for a new line
          </span>
          {busy ? (
            <Tip content="Stop. Keeps what has arrived so far." side="top">
              <Button variant="ghost" size="icon" aria-label="Stop" onClick={onStop} className="text-text-1">
                <Square className="h-4 w-4 fill-current" aria-hidden="true" />
              </Button>
            </Tip>
          ) : (
            <Button size="icon" aria-label="Send" onClick={submit} disabled={!canSend}>
              <Send className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function QuickItem({ icon, label, onClick }: { icon: ReactElement; label: string; onClick: () => void }) {
  return (
    <Menu.Item onClick={onClick} className="flex h-9 cursor-default items-center gap-2 rounded-button px-3 text-[14px] text-text-1 outline-none data-[highlighted]:bg-accent-subtle">
      {icon}
      {label}
    </Menu.Item>
  );
}
