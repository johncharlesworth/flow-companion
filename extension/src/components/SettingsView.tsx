import { ArrowLeft, ChevronRight, CircuitBoard, ExternalLink, Eye, EyeOff, Gem, type LucideIcon, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';

import { useSettings } from '@/hooks/useSettings';
import { DEMO_PATH } from '@/lib/demo-flow';
import { keyFormatHint, keyStatusLine, type KeyLineState } from '@/lib/key-copy';
import { validateKeyFormat } from '@/lib/key-format';
import { getProviderKey, moveProviderKeys, removeAllProviderKeys, setProviderKey } from '@/lib/key-storage';
import { buildPicker, defaultModel, findSpec, type ProviderId, PROVIDERS, providerName } from '@/lib/models';
import { CARD_TITLE, disclosureFor, GET_KEY_URL, GOOGLE_FREE_TIER_NOTE, SUBSCRIPTION_NOTE, WHAT_IS_SENT_URL } from '@/lib/provider-links';
import { CUSTOM_INSTRUCTIONS_MAX, keyStorageMode, last4 } from '@/lib/settings';
import type { ThemeSetting } from '@/lib/theme';
import { validateKey } from '@/lib/validate-key';
import { stopAllRuns } from '@/hooks/useChatStream';

import { ModelMenu } from './ModelMenu';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { RadioGroup } from './ui/radio-group';
import { Textarea } from './ui/textarea';

const MARK: Record<ProviderId, LucideIcon> = { anthropic: Sparkles, openai: CircuitBoard, google: Gem };

export interface SettingsViewProps {
  onBack: () => void;
  /** No working key yet: only the AI provider section is expanded and "Start chatting" appears once a key is accepted. */
  firstRun?: boolean;
  onStartChatting?: () => void;
  /** For "too small for this flow" in the model menu. */
  flowTokens?: number | null;
  /** Rendered inside the demo tab: "Try the demo" is hidden. */
  demo?: boolean;
  /** Injected in tests. */
  validate?: typeof validateKey;
}

function SavedPill({ show }: { show: boolean }) {
  return show ? <span className="rounded-pill bg-accent-subtle px-2 py-0.5 text-xs text-accent">Saved</span> : null;
}

function useSavedPill(): { saved: boolean; markSaved: () => void } {
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 1_500);
    return () => clearTimeout(timer);
  }, [saved]);
  return { saved, markSaved: () => setSaved(true) };
}

export function SettingsView({ onBack, firstRun = false, onStartChatting, flowTokens = null, demo = false, validate = validateKey }: SettingsViewProps) {
  const { settings, readiness, loaded, update } = useSettings();
  // The card the user opened; until they open one, the active provider's card is open.
  const [chosen, setChosen] = useState<ProviderId | null>(null);
  const { saved: answersSaved, markSaved: markAnswersSaved } = useSavedPill();
  const { saved: appearanceSaved, markSaved: markAppearanceSaved } = useSavedPill();
  const [confirmForget, setConfirmForget] = useState(false);

  const active = settings.activeProvider;
  const expanded = chosen ?? active;
  const currentModelId = active ? settings.modelByProvider[active] : null;
  const currentModelLabel = active && currentModelId ? (findSpec(active, currentModelId)?.label ?? currentModelId) : null;
  const picker = active ? buildPicker(active, settings.keys[active].models, flowTokens) : null;

  // Opening a card only expands it. A provider becomes the active one when its
  // key is accepted, or when the user opens a card whose key is already
  // accepted (switching between set-up providers; the transcript is kept).
  // Looking at a card must never gate the panel back to "Set up your AI".
  const chooseProvider = async (provider: ProviderId) => {
    setChosen(provider);
    if (settings.keys[provider].status === 'validated' && settings.activeProvider !== provider) {
      await update((s) => ({ ...s, activeProvider: provider }));
    }
  };

  const forgetEverything = async () => {
    stopAllRuns(); // a run still streaming in the background must not write its chat back after the wipe
    await removeAllProviderKeys();
    await browser.storage.local.clear();
    await browser.storage.session.clear();
    try {
      window.localStorage.removeItem('flow-companion:theme');
    } catch {
      /* ignore */
    }
    delete document.documentElement.dataset.theme;
    setConfirmForget(false);
    setChosen(null);
    onBack(); // the panel now shows "Set up your AI", which confirms the reset
  };

  if (!loaded) return null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-1 px-2">
        <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <h1 className="text-[14px] font-semibold text-text-1">Settings</h1>
      </header>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 pb-6">
        <section className="rounded-composer bg-surface p-3" aria-labelledby="settings-provider">
          <h2 id="settings-provider" className="px-2 text-[15px] font-semibold text-text-1">
            AI provider
          </h2>
          <p className="mb-2 px-2 text-xs text-text-3">{SUBSCRIPTION_NOTE}</p>
          <div className="flex flex-col gap-1">
            {PROVIDERS.map((provider) => (
              <ProviderCard
                key={provider}
                provider={provider}
                selected={expanded === provider}
                isActive={active === provider}
                status={settings.keys[provider].status}
                last4={settings.keys[provider].last4}
                remember={settings.rememberOnDevice}
                onSelect={() => void chooseProvider(provider)}
                onSwitchTo={(p) => void chooseProvider(p)}
                onRemember={async (next) => {
                  await moveProviderKeys(keyStorageMode(settings), next ? 'local' : 'session');
                  await update((s) => ({ ...s, rememberOnDevice: next }));
                }}
                validate={validate}
                readStoredKey={() => getProviderKey(provider, keyStorageMode(settings))}
                onValidated={async (outcome, key, models) => {
                  const mode = keyStorageMode(settings);
                  if (outcome !== 'rejected') await setProviderKey(provider, key, mode);
                  await update((s) => ({
                    ...s,
                    // The provider the user just set up becomes the active one; a rejected key changes nothing.
                    activeProvider: outcome === 'rejected' ? s.activeProvider : provider,
                    keys: {
                      ...s.keys,
                      [provider]: {
                        status: outcome === 'accepted' ? 'validated' : outcome === 'rejected' ? 'rejected' : 'unchecked',
                        last4: outcome === 'rejected' ? s.keys[provider].last4 : last4(key),
                        models: outcome === 'accepted' ? models : s.keys[provider].models,
                        checkedAt: Date.now(),
                      },
                    },
                  }));
                }}
              />
            ))}
          </div>
          {active && picker && currentModelId && (
            <div className="mt-2 flex items-center gap-2 px-2 text-[14px] text-text-2">
              <span>
                Default model: <span className="text-text-1">{currentModelLabel}</span>
              </span>
              <ModelMenu
                provider={active}
                picker={picker.recommended.length + picker.more.length > 0 ? picker : { recommended: [{ ...defaultModel(active), tooSmall: false }], more: [] }}
                currentId={currentModelId}
                onSelect={(id) => void update((s) => ({ ...s, modelByProvider: { ...s.modelByProvider, [active]: id } }))}
                onManageProviders={() => {}}
                trigger={
                  <button type="button" className="inline-flex items-center text-accent">
                    Change <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                }
              />
            </div>
          )}
          {firstRun && readiness.ready && onStartChatting && (
            <Button className="mt-3 w-full" onClick={onStartChatting}>
              Start chatting
            </Button>
          )}
        </section>

        {!firstRun && (
          <>
            <section className="rounded-composer bg-surface p-3" aria-labelledby="settings-answers">
              <div className="mb-2 flex items-center gap-2 px-2">
                <h2 id="settings-answers" className="text-[15px] font-semibold text-text-1">
                  Answers
                </h2>
                <SavedPill show={answersSaved} />
              </div>
              <div className="px-2">
                <label htmlFor="custom-instructions" className="text-[14px] text-text-1">
                  How should the assistant respond?
                </label>
                <Textarea
                  id="custom-instructions"
                  className="mt-1"
                  rows={3}
                  maxLength={CUSTOM_INSTRUCTIONS_MAX}
                  defaultValue={settings.customInstructions}
                  placeholder="“I’m a junior admin, define jargon.” · “Answer in Portuguese.” · “Always list DML by object.”"
                  onBlur={(e) => {
                    const value = e.target.value.slice(0, CUSTOM_INSTRUCTIONS_MAX);
                    if (value === settings.customInstructions) return;
                    void update((s) => ({ ...s, customInstructions: value })).then(markAnswersSaved);
                  }}
                />
              </div>
              <div className="mt-3 px-2">
                <span className="text-[14px] text-text-1">Detail</span>
                <RadioGroup
                  name="detail"
                  aria-label="Detail"
                  value={settings.detail}
                  onChange={(value) => void update((s) => ({ ...s, detail: value })).then(markAnswersSaved)}
                  options={[
                    { value: 'concise', label: 'Concise' },
                    { value: 'balanced', label: 'Balanced' },
                    { value: 'thorough', label: 'Thorough' },
                  ]}
                />
                <p className="mt-1 px-2 text-xs text-text-3">
                  Thorough answers take longer and use more of your provider’s credit. Changing this mid-chat re-sends the conversation once on Anthropic.
                </p>
              </div>
            </section>

            <section className="rounded-composer bg-surface p-3" aria-labelledby="settings-appearance">
              <div className="mb-2 flex items-center gap-2 px-2">
                <h2 id="settings-appearance" className="text-[15px] font-semibold text-text-1">
                  Appearance
                </h2>
                <SavedPill show={appearanceSaved} />
              </div>
              <RadioGroup
                name="theme"
                aria-label="Appearance"
                value={settings.theme}
                onChange={(value: ThemeSetting) => void update((s) => ({ ...s, theme: value })).then(markAppearanceSaved)}
                options={[
                  { value: 'system', label: 'System' },
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                ]}
              />
            </section>

            <section className="flex flex-col items-start gap-3 px-2">
              {!demo && (
                <a href={DEMO_PATH} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[14px] text-accent">
                  Try the demo <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              )}
              {confirmForget ? (
                <div className="rounded-composer bg-surface p-3">
                  <p className="text-[14px] text-text-1">This removes your keys, settings, and every chat from this computer.</p>
                  <div className="mt-3 flex gap-2">
                    <Button onClick={() => void forgetEverything()}>Forget everything</Button>
                    <Button variant="ghost" onClick={() => setConfirmForget(false)}>
                      Keep
                    </Button>
                  </div>
                </div>
              ) : (
                <button type="button" className="text-[14px] text-danger" onClick={() => setConfirmForget(true)}>
                  Forget everything on this computer
                </button>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface ProviderCardProps {
  provider: ProviderId;
  selected: boolean;
  isActive: boolean;
  status: 'unset' | 'validated' | 'rejected' | 'unchecked';
  last4: string | null;
  remember: boolean;
  onSelect: () => void;
  onSwitchTo: (provider: ProviderId) => void;
  onRemember: (next: boolean) => Promise<void>;
  validate: typeof validateKey;
  /** The saved key, for "Check again" on a key whose check never completed. */
  readStoredKey: () => Promise<string | null>;
  onValidated: (outcome: 'accepted' | 'rejected' | 'rateLimited' | 'unreachable', key: string, models: { id: string; maxInputTokens?: number }[]) => Promise<void>;
}

function ProviderCard({ provider, selected, isActive, status, last4: saved4, remember, onSelect, onSwitchTo, onRemember, validate, readStoredKey, onValidated }: ProviderCardProps) {
  const Mark = MARK[provider];
  const name = providerName(provider);
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [line, setLine] = useState<KeyLineState>(status === 'validated' ? 'accepted' : status === 'rejected' ? 'rejected' : 'idle');
  const checkedRef = useRef<string>('');

  const hint = key ? keyFormatHint(provider, validateKeyFormat(provider, key)) : null;

  const check = async (value: string, force = false) => {
    const trimmed = value.trim();
    if (!trimmed || (!force && trimmed === checkedRef.current)) return;
    checkedRef.current = trimmed;
    setLine('checking');
    const result = await validate(provider, trimmed);
    setLine(result.outcome);
    await onValidated(result.outcome, trimmed, result.outcome === 'accepted' ? result.models : []);
  };

  // A key whose check never completed (offline, rate limited) can be checked again without pasting it again.
  const canRecheck = line === 'unreachable' || line === 'rateLimited' || (line === 'idle' && status === 'unchecked');
  const recheck = async () => {
    const value = key.trim() || (await readStoredKey());
    if (value) await check(value, true);
  };

  const statusText = keyStatusLine(provider, line) || (status === 'validated' && saved4 ? 'Key accepted' : status === 'unchecked' && saved4 ? `Key ending in ${saved4} saved, not checked yet` : '');
  const statusTone = line === 'accepted' || (line === 'idle' && status === 'validated') ? 'text-success' : line === 'rejected' ? 'text-danger' : 'text-text-2';

  return (
    <div className={selected ? 'rounded-composer bg-bg p-3' : 'rounded-composer p-3'}>
      <button type="button" className="flex w-full items-center gap-3 text-left" onClick={onSelect} aria-expanded={selected}>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-subtle">
          <Mark className="h-4 w-4 text-accent" aria-hidden="true" />
        </span>
        <span className="flex-1 text-[14px] font-medium text-text-1">{CARD_TITLE[provider]}</span>
        {isActive && status === 'validated' && <span className="text-xs text-success">Active</span>}
        {!selected && status === 'validated' && !isActive && <span className="text-xs text-text-3">Key saved</span>}
      </button>

      {selected && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input
              type={show ? 'text' : 'password'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData('text');
                if (pasted) {
                  e.preventDefault();
                  setKey(pasted);
                  void check(pasted);
                }
              }}
              onBlur={() => void check(key)}
              placeholder={saved4 ? `Saved key ending in ${saved4}` : `Paste your ${name} key`}
              aria-label={`${name} API key`}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-button border border-hairline bg-composer px-3 py-2 font-mono text-[13px] text-text-1 placeholder:font-sans placeholder:text-text-3"
            />
            <Button variant="ghost" size="icon" aria-label={show ? 'Hide key' : 'Show key'} onClick={() => setShow((v) => !v)}>
              {show ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className={statusTone} role="status">
              {line === 'accepted' || (line === 'idle' && status === 'validated') ? <span className="mr-1 inline-block h-2 w-2 rounded-full bg-success" aria-hidden="true" /> : null}
              {statusText}
              {canRecheck && (
                <button type="button" onClick={() => void recheck()} className="ml-2 text-accent underline-offset-2 hover:underline">
                  Check again
                </button>
              )}
            </span>
            <a href={GET_KEY_URL[provider]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 whitespace-nowrap text-accent">
              Get a key <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </div>
          {hint && (
            <p className="text-xs text-warning">
              {hint.text}{' '}
              {hint.switchTo && (
                <button type="button" className="underline" onClick={() => onSwitchTo(hint.switchTo!)}>
                  Switch to {providerName(hint.switchTo)}
                </button>
              )}
            </p>
          )}
          <Checkbox
            checked={remember}
            onChange={(next) => void onRemember(next)}
            label="Remember this key on this computer"
            description="Turn off on a shared computer; the key is then forgotten when Chrome closes."
          />
          <p className="text-xs text-text-3">
            {disclosureFor(name)}{' '}
            <a href={WHAT_IS_SENT_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent">
              What is sent? <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </p>
          {provider === 'google' && <p className="text-xs text-text-3">{GOOGLE_FREE_TIER_NOTE}</p>}
        </div>
      )}
    </div>
  );
}
