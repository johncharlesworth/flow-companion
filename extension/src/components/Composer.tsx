import { Menu } from '@base-ui/react/menu';
import { Popover } from '@base-ui/react/popover';
import { ChevronDown, FileText, Gauge, ListTree, Send, Sparkles, Square, Waypoints } from 'lucide-react';
import { Fragment, type KeyboardEvent, type ReactElement, type RefObject, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { cn } from '@/lib/cn';
import { handFocusBack } from '@/lib/hand-focus';
import type { ChatMode } from '@/lib/modes';

import { Button } from './ui/button';
import { Tip } from './ui/tooltip';

export interface ComposerProps {
  flowLabel: string;
  /** The gauge button: one plain sentence (the consequence), a one-line hover summary after an answer (null before), and the card's rows (zeros before). */
  chipStory: string;
  chipSummary?: string | null;
  chipRows: [label: string, value: string][];
  /** The model chip, already wrapped in its menu. Absent in the demo flow, where no model is chosen. */
  modelChip?: ReactElement;
  /** An answer is arriving: Send becomes Stop, and Actions is off (every row in it would start another answer). */
  busy: boolean;
  disabled?: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onQuickAction: (mode: Exclude<ChatMode, 'ask'>) => void;
  /** Opens the element picker with the draw intent (the picture around one element). */
  onDrawFromElement: () => void;
  /** Draws every element by its API name. */
  onDrawEvery: () => void;
  blocked: { message: string; switchLabel?: string; onSwitch?: () => void } | null;
  nudge: boolean;
  onNewChat: () => void;
  onDismissNudge: () => void;
  /**
   * The demo flow: only the four actions can run, because their answers were
   * recorded, and the view above offers them as cards and then as a row of
   * chips. The message box is off, and there is no Actions, no model chip, and no
   * gauge (nothing is sent, so there is nothing to count): the bottom row
   * carries Send alone. The placeholder names the next step: a key when there
   * is none (`keyReady` false, with one link to set it up left of Send),
   * otherwise a real flow in Flow Builder. The banner above the transcript
   * says what the demo is; `describedBy` is its element id, so assistive
   * tech hears it too.
   */
  recorded?: { keyReady: boolean; onSetUp: () => void; describedBy: string } | null;
  /** The message box itself, so the view around it can hand focus back (after "Jump to latest"). */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}

// The whole box, not the textarea: the toolbar (and the "too big" notice, when
// it shows) are measured out of it, so the cap holds whatever else the box is
// carrying. 440px leaves room for long messages; a six-line cap (about
// 181px) would cut them short.
const MAX_BOX_PX = 440;

export function Composer({ flowLabel, chipStory, chipSummary, chipRows, modelChip, busy, disabled = false, onSend, onStop, onQuickAction, onDrawFromElement, onDrawEvery, blocked, nudge, onNewChat, onDismissNudge, recorded = null, inputRef }: ComposerProps) {
  const [text, setText] = useState('');
  // The gauge: hover peeks at the flow's story, a click pins the card.
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Where focus goes when the Actions menu closes. After a row that starts an answer, the message box: Actions is off while
  // the answer arrives, so returning focus to it would drop it to the page (the box is busy and ignores Enter). After a row
  // that opens the element picker, nowhere: the picker's search takes it. Otherwise (Escape, a click away), Actions itself.
  const afterMenuRef = useRef<'box' | 'picker' | null>(null);
  // The textarea is always rendered, so the view's handle is never left null.
  useImperativeHandle(inputRef, () => ref.current as HTMLTextAreaElement, []);

  // Sizes the box to its text: on every keystroke, when the placeholder or the
  // "too big" notice changes what it holds, when the panel is dragged to a new
  // width (the same text wraps to more lines, or fewer), and once the fonts have
  // loaded (the first measure can run before IBM Plex has). Keystrokes alone
  // are not enough: narrowing the panel would hide a draft's last line.
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 22;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    // Two lines from the start: one line of text
    // sits in a box already tall enough for two, so typing the second line does
    // not move the toolbar. The third line is the first that grows it.
    const twoLines = line * 2 + pad;
    // Everything the box holds besides the textarea, measured rather than
    // assumed, so the "too big" notice does not push the box past the cap.
    const box = el.parentElement;
    const chrome = box ? box.offsetHeight - el.offsetHeight : 0;
    const cap = Math.max(twoLines, MAX_BOX_PX - chrome);
    el.style.height = `${Math.max(twoLines, Math.min(el.scrollHeight, cap))}px`;
  }, []);
  const placeholderKey = recorded ? String(recorded.keyReady) : '';
  useEffect(resize, [resize, text, placeholderKey, blocked?.message]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let width = el.clientWidth;
    // Only a new width re-wraps the text; a new height is this component's own doing.
    // Deferred a frame: resizing the observed element inside its own callback makes Chrome report a (harmless) loop error.
    let frame = 0;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(resize);
    });
    observer?.observe(el);
    void document.fonts?.ready.then(resize);
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [resize]);

  const submit = () => {
    if (busy || disabled || blocked || recorded) return;
    const trimmed = text.trim();
    if (!trimmed) return;
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
    : 'Ask about this flow…';
  const canSend = !disabled && !busy && !blocked && !recorded && text.trim().length > 0;

  // Hover: one line. Click: the breakdown.
  const chipHover = chipSummary ?? chipStory;

  return (
    <div className="shrink-0 px-3 pb-3">
      {nudge && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-composer border border-hairline bg-bg px-3 py-2 text-[14px] text-text-1 shadow-composer" role="status">
          {/* A 200px basis rather than flex-1, so on a panel too narrow for the sentence and the buttons side by side the buttons drop to a second line instead of squeezing the sentence into a column. */}
          <span className="flex-[1_1_200px]">This chat is getting long. Start a new chat to keep answers quick. The flow stays attached.</span>
          {/* The two buttons wrap as one, never split across lines. */}
          <div className="flex items-center gap-2">
            <Button onClick={onNewChat}>New chat</Button>
            <Button variant="ghost" onClick={onDismissNudge}>
              Not now
            </Button>
          </div>
        </div>
      )}
      <div className="rounded-composer border border-composer-line bg-composer shadow-composer">
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
          className={cn(
            'block w-full resize-none bg-transparent px-4 pb-0 pt-3 text-[14px] leading-[1.55] text-text-1 outline-none placeholder:text-text-3',
            // Off in the demo flow, but not dimmed: there the placeholder is the line that names the next step.
            !recorded && 'disabled:opacity-60',
          )}
        />
        {/* 7px above, off the message, and none below: the toolbar's own 14px is the gap to the controls, as it is without the notice. */}
        {blocked && (
          <div className="mx-3 mt-[7px] flex flex-wrap items-center gap-2 rounded-button bg-bg px-2 py-1.5 text-xs text-text-1" role="status">
            <span className="flex-[1_1_200px]">{blocked.message}</span>
            {blocked.switchLabel && blocked.onSwitch && (
              <button type="button" onClick={blocked.onSwitch} className="rounded-button bg-accent px-2 py-1 text-xs font-medium text-accent-fg">
                {blocked.switchLabel}
              </button>
            )}
          </div>
        )}
        {/* The bottom row: Actions hard left, then the slack, then the model chip, the gauge and Send. The demo flow has no Actions to push the rest right, so it right-aligns the row instead. */}
        <div className={cn('flex items-center gap-2 px-3 pb-4 pt-4', recorded && 'justify-end')}>
          {/* Actions opens the quick actions. It belongs to the live chat; the demo flow offers its four actions as cards and chips above. */}
          {!recorded && (
            <Menu.Root>
              <Tip content="Overview, draw, document, explain an element" side="top">
                <Menu.Trigger
                  render={
                    <Button variant="chip" size="chip" disabled={disabled || busy} className="mr-auto border border-composer-line">
                      {/* The word sits 1px below the chip's centre, and so does the chevron (centred, each would read high); the border stays put. */}
                      <span className="translate-y-px">Actions</span>
                      {/* Two steps quieter than the word. */}
                      <ChevronDown className="h-3.5 w-3.5 translate-y-[1px] text-text-3" aria-hidden="true" />
                    </Button>
                  }
                />
              </Tip>
              <Menu.Portal>
                <Menu.Positioner side="top" align="end" sideOffset={6} className="z-50">
                  <Menu.Popup
                    finalFocus={() => {
                      const to = afterMenuRef.current;
                      afterMenuRef.current = null;
                      return to === 'box' ? ref.current : to !== 'picker';
                    }}
                    // 190px: the longest row ends 25px from the edge, against 55px at 220.
                    className="min-w-[190px] rounded-popover bg-surface-elevated p-1 shadow-elevated outline-none"
                  >
                    <QuickItem icon={<Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />} label="Overview" onClick={() => ((afterMenuRef.current = 'box'), onQuickAction('overview'))} />
                    {/* The three pictures together, named this way in the menu only: the card and the website keep the action's name, "Draw this flow". */}
                    <QuickItem icon={<Waypoints className="h-4 w-4 text-accent" aria-hidden="true" />} label="Draw main paths" onClick={() => ((afterMenuRef.current = 'box'), onQuickAction('draw'))} />
                    {/* No "…" after it, though it opens the element picker. */}
                    <QuickItem icon={<Waypoints className="h-4 w-4 text-accent" aria-hidden="true" />} label="Draw one element" onClick={() => ((afterMenuRef.current = 'picker'), onDrawFromElement())} />
                    <QuickItem icon={<Waypoints className="h-4 w-4 text-accent" aria-hidden="true" />} label="Draw every element" onClick={() => ((afterMenuRef.current = 'box'), onDrawEvery())} />
                    <QuickItem icon={<FileText className="h-4 w-4 text-accent" aria-hidden="true" />} label="Document this flow" onClick={() => ((afterMenuRef.current = 'box'), onQuickAction('document'))} />
                    <QuickItem icon={<ListTree className="h-4 w-4 text-accent" aria-hidden="true" />} label="Explain an element" onClick={() => ((afterMenuRef.current = 'picker'), onQuickAction('explain'))} />
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
          )}
          {/* A flex box, so the chip inside can shrink: on a panel too narrow for the whole row the name ends in an ellipsis instead of running under the gauge. */}
          <span className="flex min-w-0">{modelChip}</span>
          {/* The gauge: what the flow costs to ask about. Hover is one line; a click pins the card with the provider's numbers. Not in the demo flow, where nothing is sent. */}
          {!recorded && (
            <Popover.Root open={pinned} onOpenChange={setPinned}>
              {/* One stable button: the tooltip goes quiet while pinned, so the popover keeps its anchor. The pinned fill keys on aria-expanded, which only the popover sets: the tooltip sets data-popup-open too, so keyed on that, keyboard focus alone would make the gauge look pinned. */}
              <Tip content={chipHover} side="top" disabled={pinned}>
                <Popover.Trigger render={<Button variant="ghost" size="icon" aria-label={`About this flow: ${flowLabel}`} className="ml-[2px] aria-expanded:bg-accent-subtle aria-expanded:text-text-1" />}>
                  <Gauge className="h-[20px] w-[20px]" aria-hidden="true" />
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
          {/* The way to a key, only while there is none: with one, the next step is a real flow, and the placeholder says so. */}
          {recorded && !recorded.keyReady && (
            <button type="button" onClick={recorded.onSetUp} className="rounded-button px-2 py-1 text-[13px] text-accent underline-offset-2 hover:underline">
              Set up your AI
            </button>
          )}
          {busy ? (
            <Tip content="Stop. Keeps what has arrived so far." side="top">
              {/* Send's 5px too, so the gauge and the model chip hold still when an answer starts. */}
              <Button
                variant="ghost"
                size="icon"
                aria-label="Stop"
                onClick={(e) => {
                  onStop();
                  // Stop unmounts as Send returns. After a click, back to the box; from the keyboard, not: the box is idle now, so a second Enter would send the draft.
                  handFocusBack(ref.current, { pointer: e.detail > 0 });
                }}
                className="ml-[5px]"
              >
                <Square className="h-4 w-4 fill-current" aria-hidden="true" />
              </Button>
            </Tip>
          ) : (
            <Button
              size="icon"
              aria-label="Send"
              className="ml-[5px]"
              onClick={(e) => {
                submit();
                // Send unmounts as Stop arrives; back to the box, where Enter is ignored while an answer runs, so the keyboard is safe too.
                handFocusBack(ref.current, { pointer: e.detail > 0, keyboardToo: true });
              }}
              disabled={!canSend}
            >
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
