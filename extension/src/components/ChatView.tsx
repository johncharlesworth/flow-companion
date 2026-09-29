import { ArrowLeft, ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import recordedWith from '@@/test/fixtures/synthetic-demo-recorded-with.json';
import type { ActiveFlow } from '@/hooks/useActiveFlow';
import { useChatStream } from '@/hooks/useChatStream';
import { BILLING_URL, type ChatErrorAction, RATE_LIMIT_URL } from '@/lib/chat-errors';
import { downloadFilename, downloadTextFile } from '@/lib/download';
import { buildOutline, focusElementFor, type OutlineItem, summaryLine } from '@/lib/flow-outline';
import { hoverRows, hoverSummary, sizeWord as sizeWordFor } from '@/lib/flow-size';
import { handFocusBack } from '@/lib/hand-focus';
import { buildPicker, findSpec, type ProviderId, providerName } from '@/lib/models';
import { type ChatMode, type DrawVariant, type FocusElement, STARTER_QUESTIONS } from '@/lib/modes';
import type { Settings } from '@/lib/settings';

import { Chip } from './Chip';
import { Composer } from './Composer';
import { ElementList } from './ElementList';
import { Header, type HeaderFlow } from './Header';
import { ModelMenu } from './ModelMenu';
import { Transcript } from './Transcript';
import { Button } from './ui/button';
import { FileText, ListTree, type LucideIcon, MessageSquareText, Sparkles, Waypoints } from 'lucide-react';

export const RESIZE_TIP = 'Tip: drag the panel’s left edge to make it wider.';
/** The empty transcript's heading. */
export const EMPTY_HEADING = 'Ask anything about this flow.';
/** The four quick actions on the empty transcript, each with what comes back. */
export const ACTION_COPY = {
  overview: { title: 'Overview', body: 'The whole flow summarized, including the trigger, the main paths, and what it updates.' },
  explain: { title: 'Explain an element', body: 'Pick an element of your flow to have explained with its exact conditions and outcomes.' },
  document: { title: 'Document this flow', body: 'The full write-up, with all resources and data operations. Copy it or download as Markdown.' },
  draw: { title: 'Draw this flow', body: 'The main paths drawn as one flowchart. Open in Excalidraw or copy the Mermaid text.' },
} as const;
/** Under the Outline, live and in the demo alike: a pick explains the element at once. */
export const OUTLINE_HINT = 'Pick one to see it explained.';
export const NEW_CHAT_CONFIRM = 'Start a new chat? This conversation will be cleared.';
/**
 * Draw every element asks first above this many elements: past about 100, the wait nears a minute and a
 * half. On Claude Sonnet 5, 81 elements took 46 seconds and 153 took two and a half to three minutes.
 */
export const DRAW_EVERY_ASK_ABOVE = 100;
export const DRAW_EVERY_CONFIRM = (elements: number) => `This flow has ${elements} elements. Drawing every one can take a couple of minutes.`;
/**
 * The demo flow: what is on screen and where the answers came from. The same
 * two sentences with or without a key; the message box's placeholder is what
 * names the next step. The first sentence is set in semibold.
 */
export const RECORDED_BANNER = {
  lead: 'This is a demo flow.',
  rest: (modelLabel: string) => `The four actions below play real answers, recorded from ${modelLabel}.`,
} as const;
/** The banner's element id: the disabled message box points at it, so the reason it is off is read out. */
export const SAMPLE_FLOW_BANNER_ID = 'sample-flow-banner';
export const RECORDED_HEADING = 'Try one of the four';
/**
 * Once the demo flow has an answer, the cards are gone and the message box is
 * off, so the four actions stay in sight as a row of chips over the message box.
 */
export const TRY_ANOTHER = { label: 'Try another:', group: 'Try another action' } as const;
const RECORDED_ACTIONS: { mode: Exclude<ChatMode, 'ask'>; icon: LucideIcon }[] = [
  { mode: 'overview', icon: Sparkles },
  { mode: 'draw', icon: Waypoints },
  { mode: 'document', icon: FileText },
  { mode: 'explain', icon: ListTree },
];

export interface ChatViewProps {
  flow: ActiveFlow;
  header: HeaderFlow;
  refreshing: boolean;
  onRefresh: () => void;
  settings: Settings;
  onUpdateSettings: (apply: (s: Settings) => Settings) => Promise<unknown>;
  onOpenSettings: () => void;
  now?: number;
  /**
   * The demo flow. The four actions play answers that were recorded from a
   * real model; nothing is sent, so everything that would need a request
   * (typed questions, other drawings, the model menu, the gauge) is off or hidden.
   */
  recorded?: boolean;
  /**
   * Whether a working key exists. In recorded mode it decides the message
   * box's placeholder (get a key, or open a real flow) and whether the
   * "Set up your AI" link is shown; the banner and the recording are the same
   * either way.
   */
  keyReady?: boolean;
}

export function ChatView({ flow, header, refreshing, onRefresh, settings, onUpdateSettings, onOpenSettings, now, recorded = false, keyReady = false }: ChatViewProps) {
  const chat = useChatStream({ flow, settings, recorded });
  // Recorded answers name the provider and model they came from, whatever the settings say.
  const provider = recorded ? (recordedWith.provider as ProviderId) : (settings.activeProvider ?? 'anthropic');
  const modelId = settings.modelByProvider[provider];
  const outline = useMemo(() => buildOutline(flow.metadata), [flow.metadata]);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  // The element picker serves Explain and Draw's "Draw one element"; either way a pick sends at once.
  const [picking, setPicking] = useState<'explain' | 'draw' | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  // The starter questions as a second tier under the cards, in the Outline's shape.
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // New chat is one click and clears the saved history, so a chat with messages asks first.
  const [confirmNewChat, setConfirmNewChat] = useState(false);
  const [confirmDrawEvery, setConfirmDrawEvery] = useState(false);
  const requestNewChat = () => {
    setConfirmDrawEvery(false);
    if (chat.turns.length === 0) void chat.newChat();
    else setConfirmNewChat(true);
  };

  const size = chat.flowMeasure ? sizeWordFor(chat.flowMeasure.tokens) : null;
  const large = size === 'large' || size === 'very large';
  const name = providerName(provider);
  const picker = useMemo(() => buildPicker(provider, settings.keys[provider].models, chat.flowMeasure?.tokens ?? null), [provider, settings.keys, chat.flowMeasure]);
  const currentItem = [...picker.recommended, ...picker.more].find((m) => m.id === modelId);
  const modelLabel = recorded ? recordedWith.modelLabel : (currentItem?.label ?? findSpec(provider, modelId)?.label ?? modelId);
  const modelMissing = picker.recommended.length + picker.more.length > 0 && !currentItem;

  // The gauge's one sentence: the consequence, never the mechanism; no size words anywhere in the UI. (The demo flow has no gauge.)
  const chipStory = chat.lastReused
    ? 'Follow-ups in this chat are cached and reuse the flow from memory.'
    : `Your first question sends the whole flow to ${name}. Follow-ups in this chat are cached and reuse it from memory.`;
  const chipSummary = chat.lastUsage ? hoverSummary(chat.lastUsage, provider) : null;
  // The card shows the same three rows before the first answer, at zero, so its shape is learned once.
  const chipRows = hoverRows(chat.lastUsage ?? { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }, provider);

  const focusFor = (item: OutlineItem): FocusElement | undefined => focusElementFor(flow.metadata, outline, item.name) ?? undefined;

  const send = (mode: ChatMode, question: string, variant?: DrawVariant, focusElement?: FocusElement) => {
    // Any question answers the Draw every element row: asking something else leaves the picture undrawn.
    setConfirmDrawEvery(false);
    void chat.send({ mode, variant, question, focusElement });
  };

  // Focus back to the message box after a pick or closing the picker: the list that was pressed has gone, so focus would
  // otherwise fall to the page. After the render, not now: while the picker is up the box is off, and an off box cannot
  // take focus. After a pick the box is busy and ignores Enter, so the keyboard is safe too.
  const refocusWithRef = useRef({ pointer: true, keyboardToo: true });
  const [refocus, setRefocus] = useState(0);
  useEffect(() => {
    if (refocus) handFocusBack(messageRef.current, refocusWithRef.current);
  }, [refocus]);
  const refocusBox = (options = { pointer: true, keyboardToo: true }) => {
    refocusWithRef.current = options;
    setRefocus((n) => n + 1);
  };

  // A pick from the Outline or the picker sends at once: Explain for the element, or its picture for "Draw one element".
  const pick = (item: OutlineItem, intent: 'explain' | 'draw') => {
    if (intent === 'draw') send('draw', '', 'fromElement', focusFor(item));
    else send('explain', '', undefined, focusFor(item));
    refocusBox();
  };

  const onQuickAction = (mode: Exclude<ChatMode, 'ask'>) => {
    if (mode === 'explain') {
      setConfirmDrawEvery(false);
      setPicking('explain');
      return;
    }
    send(mode, '');
  };

  const suggested = chat.blocked && !chat.blocked.ok ? chat.blocked.suggested : null;
  const blocked = chat.blocked && !chat.blocked.ok
    ? suggested
      ? { message: `This flow is too big for ${modelLabel}. ${suggested.label} can read it.`, switchLabel: `Switch to ${suggested.label}`, onSwitch: () => void onUpdateSettings((s) => ({ ...s, modelByProvider: { ...s.modelByProvider, [provider]: suggested.id } })) }
      : { message: `This flow is too big for any ${name} model you can use. Try ${provider === 'google' ? 'Anthropic or OpenAI' : provider === 'openai' ? 'Anthropic or Google' : 'Google or OpenAI'} in Settings.` }
    : null;

  const onErrorAction = (action: ChatErrorAction) => {
    if (action === 'openSettings') onOpenSettings();
    else if (action === 'openBilling') window.open(BILLING_URL[provider], '_blank', 'noopener');
    else if (action === 'openProviderSite') window.open(RATE_LIMIT_URL[provider], '_blank', 'noopener');
    else if (chat.status !== 'idle') return; // a model is picked only while nothing is arriving
    else if (action === 'openModelMenu') setMenuOpen(true);
    else if (action === 'switchModel' && suggested) blocked?.onSwitch?.();
  };

  // No model chip in the demo flow: the banner already names the model the answers came from.
  const modelChip = recorded ? undefined : (
    <ModelMenu
      provider={provider}
      picker={picker}
      currentId={modelId}
      open={menuOpen}
      onOpenChange={setMenuOpen}
      onSelect={(id) => {
        void onUpdateSettings((s) => ({ ...s, modelByProvider: { ...s.modelByProvider, [provider]: id } }));
        const label = [...picker.recommended, ...picker.more].find((m) => m.id === id)?.label ?? id;
        chat.notice(`Switched to ${label}`);
      }}
      onManageProviders={onOpenSettings}
      trigger={
        // Off while an answer arrives, like Actions: the switch would apply to the next question anyway, and its note would land under the answer still being written.
        <button type="button" disabled={chat.status !== 'idle'} className={`inline-flex h-8 min-w-0 items-center gap-1 rounded-button px-2 text-[13px] ${modelMissing ? 'text-warning' : 'text-text-2 enabled:hover:text-text-1'} enabled:hover:bg-accent-subtle disabled:opacity-50`}>
          {/* One line always: on the narrowest panel a long label ends in an ellipsis rather than wrapping under itself. 1px below the
              chip's centre, like the word Actions beside it; the hover fill stays put. */}
          <span className="translate-y-px truncate">{modelMissing ? 'Choose a model' : modelLabel}</span>
        </button>
      }
    />
  );

  return (
    <div className="@container flex h-full flex-col">
      <Header flow={header} refreshing={refreshing} onNewChat={requestNewChat} onRefresh={onRefresh} onDownloadJson={() => downloadTextFile(downloadFilename(header.label, header.version, 'json'), JSON.stringify(flow.metadata, null, 2))} onOpenSettings={onOpenSettings} now={now} />
      {/* Right under the header, beside the New chat icon that asks for it: above the message box it would sit far
          from the icon, easy to miss in a full-height window. */}
      {confirmNewChat && (
        <div className="mx-3 mb-2 flex shrink-0 flex-wrap items-center gap-2 rounded-composer border border-hairline bg-bg px-3 py-2 text-[14px] text-text-1 shadow-composer" role="alertdialog" aria-label="Start a new chat?">
          {/* The nudge's 200px basis: the buttons wrap under the sentence rather than squeeze it. */}
          <span className="flex-[1_1_200px]">{NEW_CHAT_CONFIRM}</span>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                setConfirmNewChat(false);
                setConfirmDrawEvery(false);
                void chat.newChat();
              }}
            >
              New chat
            </Button>
            <Button variant="ghost" onClick={() => setConfirmNewChat(false)}>
              Keep
            </Button>
          </div>
        </div>
      )}
      {recorded && (
        <p id={SAMPLE_FLOW_BANNER_ID} className="mx-3 mb-2 shrink-0 rounded-composer bg-accent-subtle px-3 py-2 text-[13px] leading-[1.45] text-text-1" role="status">
          <span className="font-semibold">{RECORDED_BANNER.lead}</span> {RECORDED_BANNER.rest(modelLabel)}
        </p>
      )}
      {picking ? (
        <div
          role="presentation"
          className="flex min-h-0 flex-1 flex-col py-2"
          onKeyDown={(e) => {
            // Back to the composer, nothing sent. Escape cannot send, so the keyboard may take focus back too.
            if (e.key === 'Escape') {
              setPicking(null);
              refocusBox();
            }
          }}
        >
          <div className="flex h-9 items-center gap-1 px-2 pb-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Back"
              onClick={(e) => {
                setPicking(null);
                // After a click; from the keyboard a second Enter would land in the box and could send a draft.
                refocusBox({ pointer: e.detail > 0, keyboardToo: false });
              }}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <span className="text-[14px] font-semibold text-text-1">{picking === 'draw' ? 'Draw one element' : 'Explain an element'}</span>
          </div>
          <ElementList
            outline={outline}
            focusSearch
            onSelect={(item) => {
              pick(item, picking === 'draw' ? 'draw' : 'explain');
              setPicking(null);
            }}
          />
        </div>
      ) : chat.turns.length === 0 ? (
        // The transcript's fade here too: on a short window the first screen overflows, and without it the cards would be sliced on the message box's edge.
        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* The fade's own 28px under the content, so the last line can be scrolled clear of it. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-[28px]">
            <div className="flex flex-col items-center gap-4 px-6 pt-10 text-center">
              {/* Semibold, the screen's heading: at regular weight it reads lighter than the medium card titles under it. */}
              <p className="text-[15px] font-semibold text-text-1">{recorded ? RECORDED_HEADING : EMPTY_HEADING}</p>
              {large && <p className="max-w-[40ch] text-xs text-text-3">{`Your first question sends the whole flow to ${name}. Follow-ups in this chat are cached and reuse it from memory.`}</p>}
              {/* Chrome opens side panels narrow and remembers a dragged width. Shown on every empty screen, at any width, with 6px
                  more below it than the column's 14px, so it reads apart from the cards. */}
              <p className="mb-[6px] max-w-[40ch] text-xs text-text-3">{RESIZE_TIP}</p>
              <div className="grid w-full max-w-[560px] gap-2 text-left @min-[480px]:grid-cols-2">
                <ActionCard icon={Sparkles} {...ACTION_COPY.overview} onClick={() => onQuickAction('overview')} />
                <ActionCard icon={Waypoints} {...ACTION_COPY.draw} onClick={() => onQuickAction('draw')} />
                <ActionCard icon={FileText} {...ACTION_COPY.document} onClick={() => onQuickAction('document')} />
                <ActionCard icon={ListTree} {...ACTION_COPY.explain} onClick={() => onQuickAction('explain')} />
              </div>
            </div>
            <div className="mx-3 mt-6">
              {/* Typed questions lead to the message box, which is off in the demo flow. */}
              {!recorded && (
                <>
                  {/* The two labels in the body ink, and the small print under them in text-2, a step darker than the rest of the panel's small print. */}
                  <button type="button" aria-expanded={questionsOpen} onClick={() => setQuestionsOpen((v) => !v)} className="flex w-full items-center gap-1 rounded-button px-2 py-1.5 text-left text-[14px] text-text-1 hover:bg-accent-subtle">
                    <ChevronDown className={`h-4 w-4 transition-transform ${questionsOpen ? '' : '-rotate-90'}`} aria-hidden="true" />
                    <span className="flex-1">Questions to try</span>
                  </button>
                  {questionsOpen && (
                    <ul className="mb-2 mt-1 flex flex-col">
                      {STARTER_QUESTIONS.map((q) => (
                        <li key={q}>
                          <button type="button" onClick={() => send('ask', q)} className="flex w-full items-center gap-2 rounded-button px-2 py-1.5 text-left text-[14px] text-text-1 hover:bg-accent-subtle">
                            <MessageSquareText className="h-4 w-4 shrink-0 text-text-3" aria-hidden="true" />
                            {q}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              {/* Full width, so its hover fill matches Questions to try's. The count stays right after the word: no span here grows,
                  so nothing pushes it to the far edge. */}
              <button type="button" aria-expanded={outlineOpen} onClick={() => setOutlineOpen((v) => !v)} className="flex w-full items-center gap-1 rounded-button px-2 py-1.5 text-left text-[14px] text-text-1 hover:bg-accent-subtle">
                <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${outlineOpen ? '' : '-rotate-90'}`} aria-hidden="true" />
                <span className="shrink-0">Outline</span>
                <span className="truncate text-xs text-text-2">· {summaryLine(outline)}</span>
              </button>
              {/* Shown with the list open as well: a click explains at once, so the open list is where the hint matters. */}
              <p className="px-2 pt-1 text-xs text-text-2">{OUTLINE_HINT}</p>
              {outlineOpen && (
                // 10px from the hint to the search box.
                <div className="mt-[10px] max-h-[50vh]">
                  <ElementList outline={outline} onSelect={(item) => pick(item, 'explain')} />
                </div>
              )}
            </div>
          </div>
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-bg to-transparent" />
        </div>
      ) : (
        <Transcript
          turns={chat.turns}
          status={chat.status}
          provider={provider}
          currentModelLabel={modelLabel}
          suggestedModelLabel={suggested?.label ?? null}
          onRetry={() => {
            setConfirmDrawEvery(false);
            void chat.retry();
          }}
          onContinue={() => send('ask', 'Continue.')}
          onErrorAction={onErrorAction}
          onDownloadDocument={(markdown) => downloadTextFile(downloadFilename(header.label, header.version, 'md'), markdown, 'text/markdown')}
          onRedo={() => {
            setConfirmDrawEvery(false);
            void chat.redo();
          }}
          flowMetadata={flow.metadata}
          sendBlocked={blocked !== null}
          onJumped={(pointer) => handFocusBack(messageRef.current, { pointer })}
        />
      )}
      {/* Dismissed by anything else that starts an answer or changes the view (Retry, Try again, a picker, New chat, a question); hidden under a picker. */}
      {confirmDrawEvery && !picking && (
        <div className="mx-3 mb-2 flex flex-wrap items-center gap-2 rounded-composer border border-hairline bg-bg px-3 py-2 text-[14px] text-text-1 shadow-composer" role="alertdialog" aria-label="Draw every element?">
          <span className="flex-[1_1_200px]">{DRAW_EVERY_CONFIRM(outline.elementCount)}</span>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => {
                send('draw', 'Draw every element', 'admins');
                refocusBox();
              }}
            >
              Draw every element
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                send('draw', '');
                refocusBox();
              }}
            >
              Draw main paths
            </Button>
          </div>
        </div>
      )}
      {recorded && !picking && chat.turns.length > 0 && (
        <div role="group" aria-label={TRY_ANOTHER.group} className="mx-3 mb-2 flex shrink-0 flex-wrap items-center gap-2">
          <span className="text-xs text-text-3">{TRY_ANOTHER.label}</span>
          {RECORDED_ACTIONS.map(({ mode, icon: Icon }) => (
            // Every chip starts an answer, so the row waits while one plays.
            <Chip key={mode} icon={<Icon className="h-4 w-4 text-accent" aria-hidden="true" />} disabled={chat.status !== 'idle'} onClick={() => onQuickAction(mode)}>
              {ACTION_COPY[mode].title}
            </Chip>
          ))}
        </div>
      )}
      <Composer
        flowLabel={header.label}
        chipStory={chipStory}
        chipSummary={chipSummary}
        chipRows={chipRows}
        modelChip={modelChip}
        busy={chat.status !== 'idle'}
        disabled={picking !== null}
        onSend={(text) => send('ask', text)}
        onStop={chat.stop}
        onQuickAction={onQuickAction}
        onDrawFromElement={() => {
          setConfirmDrawEvery(false);
          setPicking('draw');
        }}
        onDrawEvery={() => (outline.elementCount > DRAW_EVERY_ASK_ABOVE ? setConfirmDrawEvery(true) : send('draw', 'Draw every element', 'admins'))}
        blocked={blocked}
        nudge={chat.nudge}
        onNewChat={() => void chat.newChat()}
        onDismissNudge={chat.dismissNudge}
        recorded={recorded ? { keyReady, onSetUp: onOpenSettings, describedBy: SAMPLE_FLOW_BANNER_ID } : null}
        inputRef={messageRef}
      />
    </div>
  );
}

/** A quick action with what comes back: the chip's look (surface, hairline, accent icon) with a 12.5px line in text-2 under the title. */
function ActionCard({ icon: Icon, title, body, onClick }: { icon: LucideIcon; title: string; body: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-start gap-3 rounded-composer border border-hairline bg-surface px-3 py-2.5 text-left transition-colors hover:bg-accent-subtle">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[14px] font-medium text-text-1">{title}</span>
        <span className="text-[12.5px] leading-[1.45] text-text-2">{body}</span>
      </span>
    </button>
  );
}
