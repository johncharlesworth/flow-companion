import { Menu } from '@base-ui/react/menu';
import { Popover } from '@base-ui/react/popover';
import { FileText, Gauge, ListTree, MessageSquareText, Plus, Send, Sparkles, Square, Waypoints, X } from 'lucide-react';
import { Fragment, type KeyboardEvent, type ReactElement, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';
import type { ChatMode } from '@/lib/modes';
import { STARTER_QUESTIONS } from '@/lib/modes';

import { Button } from './ui/button';
import { Tip } from './ui/tooltip';

export interface ComposerProps {
  flowLabel: string;
  /** The gauge button: one plain sentence (the consequence), a one-line hover summary after an answer (null before), and the card's rows (zeros before). */
  chipStory: string;
  chipSummary?: string | null;
  chipRows: [label: string, value: string][];
  element: { name: string; label: string } | null;
  onRemoveElement: () => void;
  /** The model chip, already wrapped in its menu. Absent in the demo flow, where no model is chosen. */
  modelChip?: ReactElement;
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
  /**
   * The demo flow: only the four actions can run, because their answers were
   * recorded, and the view above offers them as cards and then as a row of
   * chips. The message box is off, and there is no plus, no model chip, and no
   * gauge (nothing is sent, so there is nothing to count): the bottom row
   * carries Send alone. The placeholder names the next step: a key when there
   * is none (`keyReady` false, with one link to set it up left of Send),
   * otherwise a real flow in Flow Builder. The banner above the transcript
   * says what the demo is; `describedBy` is its element id, so assistive
   * tech hears it too.
   */
  recorded?: { keyReady: boolean; onSetUp: () => void; describedBy: string } | null;
}

const MAX_LINES = 6;

export function Composer({ flowLabel, chipStory, chipSummary, chipRows, element, onRemoveElement, modelChip, busy, disabled = false, onSend, onStop, onQuickAction, onDrawFromElement, onStarter, blocked, nudge, onNewChat, onDismissNudge, recorded = null }: ComposerProps) {
  const [text, setText] = useState('');
  // The gauge: hover peeks at the flow's story, a click pins the card.
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
    if (busy || disabled || blocked || recorded) return;
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

  const placeholder = recorded
    ? recorded.keyReady
      ? 'Your API key has been accepted. Open a flow in Flow Builder to ask your own questions.'
      : 'Asking questions requires an API key, but you can demo one of the four actions above.'
    : element
      ? `Press Enter to explain ${element.name}, or ask something about it`
      : 'Ask about this flow…';
  const canSend = !disabled && !busy && !blocked && !recorded && (text.trim().length > 0 || element !== null);

  // Hover: one line. Click: the breakdown.
  const chipHover = chipSummary ?? chipStory;

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
        {/* The top row exists only while an element is attached; otherwise the box starts with the message. */}
        {element && (
          <div className="flex flex-wrap items-center gap-2 px-4 pt-2">
            <span className="inline-flex h-7 items-center gap-1.5 rounded-pill border border-hairline bg-surface pl-2 pr-1 font-mono text-xs text-text-1">
              <ListTree className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
              {element.name}
              <button type="button" aria-label={`Remove ${element.name}`} onClick={onRemoveElement} className="rounded-full p-0.5 text-text-3 hover:bg-accent-subtle hover:text-text-1">
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          </div>
        )}
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label="Message"
          aria-describedby={recorded?.describedBy}
          rows={1}
          disabled={disabled || recorded !== null}
          className="block w-full resize-none bg-transparent px-4 pt-3 pb-2 text-[14px] leading-[1.55] text-text-1 outline-none placeholder:text-text-3 disabled:opacity-60"
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
        {/* The bottom row: the model chip at the left, lined up under the text, the icon buttons at the right, eight pixels between neighbours so the row has air. The chip takes the slack, so a long model label has the whole left side before it truncates. */}
        <div className="flex items-center gap-2 px-3 pb-2">
          <span className="min-w-0 flex-1">{modelChip}</span>
          {/* The gauge: what the flow costs to ask about. Hover is one line; a click pins the card with the provider's numbers. Not in the demo flow, where nothing is sent. */}
          {!recorded && (
            <Popover.Root open={pinned} onOpenChange={setPinned}>
              {/* One stable button: the tooltip goes quiet while pinned, so the popover keeps its anchor. */}
              <Tip content={chipHover} side="top" disabled={pinned}>
                <Popover.Trigger render={<Button variant="ghost" size="icon" aria-label={`About this flow: ${flowLabel}`} className="data-[popup-open]:bg-accent-subtle data-[popup-open]:text-text-1" />}>
                  <Gauge className="h-[18px] w-[18px]" aria-hidden="true" />
                </Popover.Trigger>
              </Tip>
              <Popover.Portal>
                <Popover.Positioner side="top" align="end" sideOffset={6} className="z-50">
                  <Popover.Popup
                    className={cn(
                      'flex flex-col gap-2 rounded-popover bg-surface-elevated px-3 py-2.5 text-xs leading-[1.45] text-text-1 shadow-elevated outline-none',
                      // With number rows the card is a fixed width so the rows line up; with only the one sentence it hugs the text.
                      chipRows.length > 0 ? 'w-[min(300px,calc(100vw-24px))]' : 'max-w-[min(300px,calc(100vw-24px))]',
                    )}
                  >
                    {/* The heading labels the numbers, so it goes when there are none to label. */}
                    {chipRows.length > 0 && <span className="font-medium text-text-2">{chipSummary ? 'Last question' : 'No questions yet'}</span>}
                    {chipRows.length > 0 && (
                      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                        {chipRows.map(([label, value]) => (
                          <Fragment key={label}>
                            <dt className="text-text-2">{label}</dt>
                            <dd className="text-right font-mono text-text-1">{value}</dd>
                          </Fragment>
                        ))}
                      </dl>
                    )}
                    <span className={cn('text-text-3', chipRows.length > 0 && 'border-t border-hairline pt-2')}>{chipStory}</span>
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
          )}
          {/* The plus opens the quick actions. It belongs to the live chat; the demo flow offers its four actions as cards and chips above. */}
          {!recorded && (
            <Menu.Root>
              <Tip content="Overview, explain an element, document, draw" side="top">
                <Menu.Trigger
                  render={
                    <Button variant="ghost" size="icon" aria-label="Quick actions" disabled={disabled}>
                      <Plus className="h-[18px] w-[18px]" aria-hidden="true" />
                    </Button>
                  }
                />
              </Tip>
              <Menu.Portal>
                <Menu.Positioner side="top" align="end" sideOffset={6} className="z-50">
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
          )}
          {/* The way to a key, only while there is none: with one, the next step is a real flow, and the placeholder says so. */}
          {recorded && !recorded.keyReady && (
            <button type="button" onClick={recorded.onSetUp} className="rounded-button px-2 py-1 text-[13px] text-accent underline-offset-2 hover:underline">
              Set up your AI
            </button>
          )}
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
