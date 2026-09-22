import { ArrowLeft, ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';

import recordedWith from '@@/test/fixtures/synthetic-demo-recorded-with.json';
import type { ActiveFlow } from '@/hooks/useActiveFlow';
import { useChatStream } from '@/hooks/useChatStream';
import { BILLING_URL, type ChatErrorAction, RATE_LIMIT_URL } from '@/lib/chat-errors';
import { downloadFilename, downloadTextFile } from '@/lib/download';
import { buildOutline, focusElementFor, type OutlineItem, summaryLine } from '@/lib/flow-outline';
import { hoverRows, hoverSummary, sizeWord as sizeWordFor } from '@/lib/flow-size';
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
/** The four quick actions on the empty transcript, each with what comes back. */
export const ACTION_COPY = {
  overview: { title: 'Overview', body: 'Purpose, trigger, main paths, and data written, in a few paragraphs.' },
  explain: { title: 'Explain an element', body: 'Pick an element. Its logic is quoted exactly, along with what leads into and out of it.' },
  document: { title: 'Document this flow', body: 'A full reference to copy or download. A couple of minutes on a large flow.' },
  draw: { title: 'Draw this flow', body: 'One flowchart of the main paths, to edit in Excalidraw or keep as Mermaid text.' },
  drawFrom: (name: string) => ({ title: `Draw ${name}`, body: 'That element, what leads into it, and where each outcome goes.' }),
} as const;
export const OUTLINE_HINT = 'See every element in this flow. Pick one to ask about it, or draw a flowchart.';
/** The same outline in the demo flow, where a pick plays the element's recorded answer. */
export const RECORDED_OUTLINE_HINT = 'Pick one to see it explained.';
export const NEW_CHAT_CONFIRM = 'Start a new chat? This conversation will be cleared.';
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
  { mode: 'explain', icon: ListTree },
  { mode: 'document', icon: FileText },
  { mode: 'draw', icon: Waypoints },
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
  const [element, setElement] = useState<OutlineItem | null>(null);
  // The element picker serves Explain (attaches a chip) and Draw's "Draw one element…" (sends at once).
  const [picking, setPicking] = useState<'explain' | 'draw' | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  // The starter questions as a second tier under the cards, in the Outline's shape.
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // New chat is one click and clears the saved history, so a chat with messages asks first.
  const [confirmNewChat, setConfirmNewChat] = useState(false);
  const requestNewChat = () => {
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

  const focusFor = (item: OutlineItem | null): FocusElement | undefined => (item ? (focusElementFor(flow.metadata, outline, item.name) ?? undefined) : undefined);

  const send = (mode: ChatMode, question: string, variant?: DrawVariant, focusElement?: FocusElement) => {
    void chat.send({ mode: element && mode === 'ask' ? 'explain' : mode, variant, question, focusElement: focusElement ?? focusFor(element) });
    setElement(null);
    if (!settings.resizeTipDone) void onUpdateSettings((s) => ({ ...s, resizeTipDone: true }));
  };

  const onQuickAction = (mode: Exclude<ChatMode, 'ask'>) => {
    if (mode === 'explain') {
      setPicking('explain');
      return;
    }
    // With an element attached, Draw draws from it (the chip and menu row say so).
    if (mode === 'draw' && element) {
      send('draw', '', 'fromElement', focusFor(element));
      return;
    }
    send(mode, '');
  };
  const drawCopy = element ? ACTION_COPY.drawFrom(element.name) : ACTION_COPY.draw;

  const onDrawFollowUp = (variant: 'admins' | 'fromElement') => {
    if (variant === 'admins') send('draw', 'Draw every element', 'admins');
    else setPicking('draw');
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
        <button type="button" className={`inline-flex h-8 min-w-0 items-center gap-1 rounded-pill px-2 text-[13px] ${modelMissing ? 'text-warning' : 'text-text-2'} hover:bg-accent-subtle`}>
          {/* One line always: on the narrowest panel a long label ends in an ellipsis rather than wrapping under itself. */}
          <span className="truncate">{modelMissing ? 'Choose a model' : modelLabel}</span>
          <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
        </button>
      }
    />
  );

  return (
    <div className="@container flex h-full flex-col">
      <Header flow={header} refreshing={refreshing} onNewChat={requestNewChat} onRefresh={onRefresh} onDownloadJson={() => downloadTextFile(downloadFilename(header.label, header.version, 'json'), JSON.stringify(flow.metadata, null, 2))} onOpenSettings={onOpenSettings} now={now} />
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
            if (e.key === 'Escape') setPicking(null); // back to the composer, nothing attached
          }}
        >
          <div className="flex h-9 items-center gap-1 px-2 pb-2">
            <Button variant="ghost" size="icon" aria-label="Back" onClick={() => setPicking(null)}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <span className="text-[14px] font-semibold text-text-1">{picking === 'draw' ? 'Draw one element' : 'Explain an element'}</span>
          </div>
          <ElementList
            outline={outline}
            focusSearch
            onSelect={(item) => {
              if (picking === 'draw') send('draw', '', 'fromElement', focusFor(item));
              // With the message box off there is no Enter to press: picking an element plays its answer.
              else if (recorded) send('explain', '', undefined, focusFor(item));
              else setElement(item);
              setPicking(null);
            }}
          />
        </div>
      ) : chat.turns.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="flex flex-col items-center gap-4 px-6 pt-10 text-center">
            <p className="text-[15px] text-text-1">{recorded ? RECORDED_HEADING : 'Ready. Ask anything about this flow.'}</p>
            {large && <p className="max-w-[40ch] text-xs text-text-3">{`Your first question sends the whole flow to ${name}. Follow-ups in this chat are cached and reuse it from memory.`}</p>}
            {/* Chrome opens side panels narrow and remembers a dragged width; one nudge, narrow panels only, until the first message ever sent. */}
            {!settings.resizeTipDone && <p className="hidden max-w-[40ch] text-xs text-text-3 @max-[399px]:block">{RESIZE_TIP}</p>}
            <div className="grid w-full max-w-[560px] gap-2 text-left @min-[480px]:grid-cols-2">
              <ActionCard icon={Sparkles} {...ACTION_COPY.overview} onClick={() => onQuickAction('overview')} />
              <ActionCard icon={ListTree} {...ACTION_COPY.explain} onClick={() => onQuickAction('explain')} />
              <ActionCard icon={FileText} {...ACTION_COPY.document} onClick={() => onQuickAction('document')} />
              <ActionCard icon={Waypoints} {...drawCopy} onClick={() => onQuickAction('draw')} />
            </div>
          </div>
          <div className="mx-3 mt-6">
            {/* Typed questions lead to the message box, which is off in the demo flow. */}
            {!recorded && (
              <>
                <button type="button" aria-expanded={questionsOpen} onClick={() => setQuestionsOpen((v) => !v)} className="flex w-full items-center gap-1 rounded-button px-2 py-1.5 text-left text-[14px] text-text-2 hover:bg-accent-subtle">
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
            <button type="button" aria-expanded={outlineOpen} onClick={() => setOutlineOpen((v) => !v)} className="inline-flex max-w-full items-center gap-1 rounded-button px-2 py-1.5 text-left text-[14px] text-text-2 hover:bg-accent-subtle">
              <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${outlineOpen ? '' : '-rotate-90'}`} aria-hidden="true" />
              <span>Outline</span>
              <span className="truncate text-xs text-text-3">· {summaryLine(outline)}</span>
            </button>
            {!outlineOpen && <p className="px-2 pt-1 text-xs text-text-3">{recorded ? RECORDED_OUTLINE_HINT : OUTLINE_HINT}</p>}
            {outlineOpen && (
              <div className="mt-1 max-h-[50vh]">
                {/* Live, a pick attaches the element to the message box. With the box off there is no Enter to press, so a pick plays the element's recorded answer. */}
                <ElementList outline={outline} onSelect={(item) => (recorded ? send('explain', '', undefined, focusFor(item)) : setElement(item))} />
              </div>
            )}
          </div>
        </div>
      ) : (
        <Transcript
          turns={chat.turns}
          status={chat.status}
          provider={provider}
          currentModelLabel={modelLabel}
          suggestedModelLabel={suggested?.label ?? null}
          onRetry={() => void chat.retry()}
          onContinue={() => send('ask', 'Continue.')}
          onErrorAction={onErrorAction}
          onDownloadDocument={(markdown) => downloadTextFile(downloadFilename(header.label, header.version, 'md'), markdown, 'text/markdown')}
          onRedo={() => void chat.redo()}
          onDrawFollowUp={recorded ? undefined : onDrawFollowUp}
          flowMetadata={flow.metadata}
        />
      )}
      {confirmNewChat && (
        <div className="mx-3 mb-2 flex flex-wrap items-center gap-2 rounded-composer bg-surface px-3 py-2 text-[14px] text-text-1" role="alertdialog" aria-label="Start a new chat?">
          <span className="flex-1">{NEW_CHAT_CONFIRM}</span>
          <Button
            onClick={() => {
              setConfirmNewChat(false);
              void chat.newChat();
            }}
          >
            New chat
          </Button>
          <Button variant="ghost" onClick={() => setConfirmNewChat(false)}>
            Keep
          </Button>
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
        element={element ? { name: element.name, label: element.label } : null}
        onRemoveElement={() => setElement(null)}
        modelChip={modelChip}
        busy={chat.status !== 'idle'}
        disabled={picking !== null}
        onSend={(text) => send('ask', text)}
        onStop={chat.stop}
        onQuickAction={onQuickAction}
        onDrawFromElement={() => setPicking('draw')}
        onStarter={(q) => send('ask', q)}
        blocked={blocked}
        nudge={chat.nudge}
        onNewChat={() => void chat.newChat()}
        onDismissNudge={chat.dismissNudge}
        recorded={recorded ? { keyReady, onSetUp: onOpenSettings, describedBy: SAMPLE_FLOW_BANNER_ID } : null}
      />
    </div>
  );
}

/** A quick action with what comes back: the chip's look (surface, hairline, accent icon) with one 12px line under the title. */
function ActionCard({ icon: Icon, title, body, onClick }: { icon: LucideIcon; title: string; body: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-start gap-3 rounded-composer border border-hairline bg-surface px-3 py-2.5 text-left transition-colors hover:bg-accent-subtle">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[14px] font-medium text-text-1">{title}</span>
        <span className="text-xs leading-[1.45] text-text-3">{body}</span>
      </span>
    </button>
  );
}
