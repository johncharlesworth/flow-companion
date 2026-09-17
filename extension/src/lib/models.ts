// The model registry and the picker rules. The
// registry knows labels, roles, limits, and request-rule families; the
// provider's live list-models call decides what actually appears, so retired
// models disappear on their own and Fable-tier models never appear.
// Ids and limits verified 2026-09-03; re-verify when this file changes.

export type ProviderId = 'anthropic' | 'openai' | 'google';

export const PROVIDERS: readonly ProviderId[] = ['anthropic', 'openai', 'google'];

/** The name on the bill; used in chat and error copy. */
export function providerName(provider: ProviderId): string {
  return { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google' }[provider];
}

export type ModelRole = 'default' | 'mostCapable' | 'fastest' | 'newest' | 'more';

export type RequestFamily =
  | 'anthropic-5' // Sonnet 5, Opus 5, Opus 4.8: adaptive thinking, output_config.effort
  | 'anthropic-4.6' // Sonnet 4.6: explicit thinking, sampling params allowed
  | 'anthropic-haiku' // Haiku 4.5: no effort control
  | 'openai-5.6' // effort none/low/medium/high/xhigh/max
  | 'openai-5' // effort none/low/medium/high/xhigh
  | 'google-3' // thinkingLevel
  | 'unknown'; // More models: universal fields only

export type Detail = 'concise' | 'balanced' | 'thorough';

export interface ModelSpec {
  id: string;
  label: string;
  role: ModelRole;
  /** Shown in the picker, e.g. "1M". */
  contextWindow: number;
  /** What the stop uses. */
  maxInputTokens: number;
  family: RequestFamily;
  /** The live list returns dated ids for this one; match by prefix. */
  matchByPrefix?: boolean;
}

const M = 1_000_000;

export const REGISTRY: Record<ProviderId, readonly ModelSpec[]> = {
  anthropic: [
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', role: 'default', contextWindow: M, maxInputTokens: M, family: 'anthropic-5' },
    { id: 'claude-opus-5', label: 'Claude Opus 5', role: 'mostCapable', contextWindow: M, maxInputTokens: M, family: 'anthropic-5' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', role: 'fastest', contextWindow: 200_000, maxInputTokens: 200_000, family: 'anthropic-haiku', matchByPrefix: true },
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', role: 'more', contextWindow: M, maxInputTokens: M, family: 'anthropic-5' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', role: 'more', contextWindow: M, maxInputTokens: M, family: 'anthropic-4.6' },
  ],
  openai: [
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', role: 'default', contextWindow: 1_050_000, maxInputTokens: 922_000, family: 'openai-5.6' },
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', role: 'mostCapable', contextWindow: 1_050_000, maxInputTokens: 922_000, family: 'openai-5.6' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', role: 'fastest', contextWindow: 1_050_000, maxInputTokens: 922_000, family: 'openai-5.6' },
    // Input caps for 5.5 and 5.4 are not published as clearly as 5.6's; the
    // 5.6 cap is assumed (the conservative direction for the stop).
    { id: 'gpt-5.5', label: 'GPT-5.5', role: 'more', contextWindow: 1_050_000, maxInputTokens: 922_000, family: 'openai-5' },
    { id: 'gpt-5.4', label: 'GPT-5.4', role: 'more', contextWindow: 1_050_000, maxInputTokens: 922_000, family: 'openai-5' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini', role: 'more', contextWindow: 400_000, maxInputTokens: 400_000, family: 'openai-5' },
  ],
  google: [
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', role: 'default', contextWindow: 1_048_576, maxInputTokens: 1_048_576, family: 'google-3' },
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', role: 'newest', contextWindow: 1_048_576, maxInputTokens: 1_048_576, family: 'google-3' },
    { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', role: 'mostCapable', contextWindow: 1_048_576, maxInputTokens: 1_048_576, family: 'google-3' },
    { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', role: 'more', contextWindow: 1_048_576, maxInputTokens: 1_048_576, family: 'google-3' },
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', role: 'more', contextWindow: 1_048_576, maxInputTokens: 1_048_576, family: 'google-3' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', role: 'more', contextWindow: 1_048_576, maxInputTokens: 1_048_576, family: 'google-3' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', role: 'more', contextWindow: 1_048_576, maxInputTokens: 1_048_576, family: 'google-3' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', role: 'more', contextWindow: 1_048_576, maxInputTokens: 1_048_576, family: 'google-3' },
  ],
};

/** Window assumed for a model the registry does not know and the live list did not size. */
export const UNKNOWN_MODEL_INPUT_TOKENS = 128_000;

/** Output reservations per turn. */
export const MAX_OUTPUT_TOKENS = { chat: 16_000, document: 48_000 } as const;

export function defaultModel(provider: ProviderId): ModelSpec {
  return REGISTRY[provider].find((m) => m.role === 'default')!;
}

export function findSpec(provider: ProviderId, id: string): ModelSpec | undefined {
  return REGISTRY[provider].find((m) => m.id === id || (m.matchByPrefix && id.startsWith(`${m.id}-`)));
}

export const ROLE_LABEL: Record<Exclude<ModelRole, 'more'>, string> = {
  default: 'Recommended for most flows',
  mostCapable: 'Most capable — slower and costs more',
  fastest: 'Fastest and cheapest — small flows only',
  newest: 'Newest',
};

// ---------------------------------------------------------------------------
// Live list filters. Each takes the provider's raw list-models
// payload and returns chat models as { id, maxInputTokens? }.

export interface LiveModel {
  id: string;
  /** From the live list when the provider reports one (Anthropic, Google). */
  maxInputTokens?: number;
}

const FABLE_RE = /^claude-fable-/;

export function filterAnthropicModels(
  data: { id: string; capabilities?: unknown; max_input_tokens?: number }[],
): LiveModel[] {
  return data
    .filter((m) => typeof m.id === 'string' && !FABLE_RE.test(m.id))
    .filter((m) => {
      if (!Array.isArray(m.capabilities)) return true;
      return m.capabilities.some((c) => typeof c === 'string' && /messages|text/i.test(c));
    })
    .map((m) => ({ id: m.id, ...(m.max_input_tokens && m.max_input_tokens > 0 ? { maxInputTokens: m.max_input_tokens } : {}) }));
}

const OPENAI_NON_CHAT_RE = /(image|realtime|audio|transcribe|tts|search|embedding|moderation|whisper|dall-e)/i;

export function filterOpenAiModels(
  data: { id: string; shutdown_date?: string | number | null }[],
  now: number = Date.now(),
): LiveModel[] {
  return data
    .filter((m) => typeof m.id === 'string' && /^gpt-/.test(m.id) && !OPENAI_NON_CHAT_RE.test(m.id))
    .filter((m) => {
      if (m.shutdown_date == null) return true;
      const when = typeof m.shutdown_date === 'number' ? m.shutdown_date * 1000 : Date.parse(m.shutdown_date);
      return Number.isNaN(when) || when > now;
    })
    .map((m) => ({ id: m.id }));
}

const GOOGLE_NON_CHAT_RE = /(image|imagen|veo|tts|audio|embed|aqa|learnlm)/i;

export function filterGoogleModels(
  data: { name: string; supportedGenerationMethods?: string[]; inputTokenLimit?: number }[],
): LiveModel[] {
  return data
    .filter((m) => typeof m.name === 'string' && m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => ({ raw: m, id: m.name.replace(/^models\//, '') }))
    .filter(({ id }) => /^gemini-/.test(id) && !GOOGLE_NON_CHAT_RE.test(id))
    .map(({ raw, id }) => ({ id, ...(raw.inputTokenLimit && raw.inputTokenLimit > 0 ? { maxInputTokens: raw.inputTokenLimit } : {}) }));
}

// ---------------------------------------------------------------------------
// Picker

export interface PickerItem {
  id: string;
  label: string;
  role: ModelRole;
  contextWindow: number;
  maxInputTokens: number;
  family: RequestFamily;
  /** "too small for this flow" */
  tooSmall: boolean;
}

export interface Picker {
  recommended: PickerItem[];
  more: PickerItem[];
}

const ROLE_ORDER: ModelRole[] = ['default', 'newest', 'mostCapable', 'fastest', 'more'];

/**
 * Recommended: registry roles present in the live list, in role order.
 * More models: everything else the key can use, registry entries first.
 * Live limits override the registry when the provider reports a positive number.
 */
export function buildPicker(provider: ProviderId, live: LiveModel[], flowTokens: number | null): Picker {
  const items: PickerItem[] = [];
  const seen = new Set<string>();
  for (const model of live) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    const spec = findSpec(provider, model.id);
    const maxInputTokens = model.maxInputTokens ?? spec?.maxInputTokens ?? UNKNOWN_MODEL_INPUT_TOKENS;
    items.push({
      id: model.id,
      label: spec?.label ?? model.id,
      role: spec?.role ?? 'more',
      contextWindow: spec?.contextWindow ?? maxInputTokens,
      maxInputTokens,
      family: spec?.family ?? 'unknown',
      tooSmall: flowTokens !== null && flowTokens > maxInputTokens,
    });
  }
  const byRole = (a: PickerItem, b: PickerItem) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
  const recommended = items.filter((i) => i.role !== 'more').sort(byRole);
  // Within Recommended, one entry per role: the registry id wins over dated variants.
  const oneEachRole = recommended.filter((item, index) => recommended.findIndex((o) => o.role === item.role) === index);
  const more = items
    .filter((i) => !oneEachRole.includes(i))
    .sort((a, b) => Number(b.family === 'unknown') - Number(a.family === 'unknown') || a.id.localeCompare(b.id))
    .sort((a, b) => Number(a.family === 'unknown') - Number(b.family === 'unknown'));
  return { recommended: oneEachRole, more };
}

export function formatWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round((tokens / 1_000_000) * 10) / 10}M`.replace('.0M', 'M');
  return `${Math.round(tokens / 1_000)}K`;
}

// ---------------------------------------------------------------------------
// Detail -> the provider's own effort control

export function effortFor(family: RequestFamily, modelId: string, detail: Detail): string | null {
  switch (family) {
    case 'anthropic-5':
      return { concise: 'low', balanced: 'medium', thorough: 'high' }[detail];
    case 'openai-5.6':
    case 'openai-5':
      return { concise: 'low', balanced: 'medium', thorough: 'high' }[detail];
    case 'google-3': {
      const hasMinimal = /^gemini-3\.[56]-flash/.test(modelId);
      return { concise: hasMinimal ? 'minimal' : 'low', balanced: 'medium', thorough: 'high' }[detail];
    }
    case 'anthropic-4.6':
    case 'anthropic-haiku':
    case 'unknown':
      return null;
  }
}
