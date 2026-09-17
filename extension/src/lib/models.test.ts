import { describe, expect, it } from 'vitest';

import {
  buildPicker,
  defaultModel,
  effortFor,
  filterAnthropicModels,
  filterGoogleModels,
  filterOpenAiModels,
  findSpec,
  formatWindow,
  PROVIDERS,
  providerName,
  REGISTRY,
  UNKNOWN_MODEL_INPUT_TOKENS,
} from './models';

describe('registry', () => {
  it('has exactly one default per provider, unique ids, and positive limits', () => {
    for (const provider of PROVIDERS) {
      const models = REGISTRY[provider];
      expect(models.filter((m) => m.role === 'default')).toHaveLength(1);
      expect(new Set(models.map((m) => m.id)).size).toBe(models.length);
      for (const m of models) {
        expect(m.maxInputTokens).toBeGreaterThan(0);
        expect(m.maxInputTokens).toBeLessThanOrEqual(m.contextWindow);
        expect(m.label).not.toMatch(/\$|%|price/i);
      }
    }
  });

  it('launch defaults are Sonnet 5, GPT-5.6 Terra, Gemini 3.5 Flash', () => {
    expect(defaultModel('anthropic').id).toBe('claude-sonnet-5');
    expect(defaultModel('openai').id).toBe('gpt-5.6-terra');
    expect(defaultModel('google').id).toBe('gemini-3.5-flash');
  });

  it('GPT-5.6 stops at the 922K input cap, not the 1.05M window', () => {
    expect(findSpec('openai', 'gpt-5.6-terra')).toMatchObject({ contextWindow: 1_050_000, maxInputTokens: 922_000 });
  });

  it('matches the dated Haiku id by prefix', () => {
    expect(findSpec('anthropic', 'claude-haiku-4-5-20251001')?.label).toBe('Claude Haiku 4.5');
    expect(findSpec('anthropic', 'claude-haiku-4-5')?.role).toBe('fastest');
    expect(findSpec('anthropic', 'claude-haiku-4-5x')).toBeUndefined();
  });

  it('names the provider the way the bill does', () => {
    expect(PROVIDERS.map(providerName)).toEqual(['Anthropic', 'OpenAI', 'Google']);
  });
});

describe('live list filters', () => {
  it('Anthropic: hides Fable-tier and non-text models, carries max_input_tokens', () => {
    const live = filterAnthropicModels([
      { id: 'claude-sonnet-5', max_input_tokens: 1_000_000 },
      { id: 'claude-fable-5-1', max_input_tokens: 1_000_000 },
      { id: 'claude-haiku-4-5-20251001', capabilities: ['messages'], max_input_tokens: 200_000 },
      { id: 'claude-voice-1', capabilities: ['audio'] },
      { id: 'claude-opus-5' },
    ]);
    expect(live).toEqual([
      { id: 'claude-sonnet-5', maxInputTokens: 1_000_000 },
      { id: 'claude-haiku-4-5-20251001', maxInputTokens: 200_000 },
      { id: 'claude-opus-5' },
    ]);
  });

  it('OpenAI: keeps gpt-* chat models, drops the rest and anything shut down', () => {
    const now = Date.parse('2026-09-03T00:00:00Z');
    const live = filterOpenAiModels(
      [
        { id: 'gpt-5.6-terra' },
        { id: 'gpt-image-2' },
        { id: 'gpt-realtime' },
        { id: 'gpt-audio' },
        { id: 'text-embedding-4' },
        { id: 'o3-pro' },
        { id: 'gpt-4.1', shutdown_date: '2026-06-01' },
        { id: 'gpt-5.5', shutdown_date: '2027-06-01' },
        { id: 'gpt-4o-transcribe' },
        { id: 'gpt-4o-search-preview' },
      ],
      now,
    );
    expect(live.map((m) => m.id)).toEqual(['gpt-5.6-terra', 'gpt-5.5']);
  });

  it('Google: keeps generateContent models, strips the models/ prefix, carries inputTokenLimit', () => {
    const live = filterGoogleModels([
      { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent', 'countTokens'], inputTokenLimit: 1_048_576 },
      { name: 'models/gemini-3.5-flash-image', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-embedding-2', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/imagen-5', supportedGenerationMethods: ['predict'] },
      { name: 'models/gemini-3.1-pro-preview', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 1_048_576 },
    ]);
    expect(live).toEqual([
      { id: 'gemini-3.5-flash', maxInputTokens: 1_048_576 },
      { id: 'gemini-3.1-pro-preview', maxInputTokens: 1_048_576 },
    ]);
  });
});

describe('buildPicker', () => {
  it('groups Recommended by role, puts everything else under More, and marks models too small for the flow', () => {
    const picker = buildPicker(
      'anthropic',
      [
        { id: 'claude-opus-5', maxInputTokens: 1_000_000 },
        { id: 'claude-sonnet-5', maxInputTokens: 1_000_000 },
        { id: 'claude-haiku-4-5-20251001', maxInputTokens: 200_000 },
        { id: 'claude-sonnet-4-6', maxInputTokens: 1_000_000 },
        { id: 'claude-something-experimental' },
      ],
      250_000,
    );
    expect(picker.recommended.map((m) => [m.id, m.role, m.tooSmall])).toEqual([
      ['claude-sonnet-5', 'default', false],
      ['claude-opus-5', 'mostCapable', false],
      ['claude-haiku-4-5-20251001', 'fastest', true],
    ]);
    expect(picker.more.map((m) => m.id)).toEqual(['claude-sonnet-4-6', 'claude-something-experimental']);
    expect(picker.more[1]).toMatchObject({ label: 'claude-something-experimental', family: 'unknown', maxInputTokens: UNKNOWN_MODEL_INPUT_TOKENS, tooSmall: true });
  });

  it('a retired registry model that the live list no longer returns simply disappears', () => {
    const picker = buildPicker('google', [{ id: 'gemini-3.5-flash', maxInputTokens: 1_048_576 }, { id: 'gemini-3.8-flash', maxInputTokens: 1_048_576 }], null);
    expect(picker.recommended.map((m) => m.id)).toEqual(['gemini-3.5-flash', 'gemini-3.8-flash']);
    expect(picker.more).toEqual([]);
    expect(picker.recommended.every((m) => m.tooSmall === false)).toBe(true);
  });

  it('a live limit overrides the registry only when it is a positive number', () => {
    const [sonnet] = buildPicker('anthropic', [{ id: 'claude-sonnet-5', maxInputTokens: 900_000 }], null).recommended;
    expect(sonnet?.maxInputTokens).toBe(900_000);
    const [terra] = buildPicker('openai', [{ id: 'gpt-5.6-terra' }], null).recommended;
    expect(terra?.maxInputTokens).toBe(922_000);
  });

  it('formats windows the way the menu shows them', () => {
    expect(formatWindow(1_000_000)).toBe('1M');
    expect(formatWindow(1_048_576)).toBe('1M');
    expect(formatWindow(400_000)).toBe('400K');
    expect(formatWindow(200_000)).toBe('200K');
  });
});

describe('effortFor', () => {
  it('maps Detail to each family’s own control, and to nothing where there is none', () => {
    expect(effortFor('anthropic-5', 'claude-sonnet-5', 'concise')).toBe('low');
    expect(effortFor('anthropic-5', 'claude-sonnet-5', 'thorough')).toBe('high');
    expect(effortFor('anthropic-haiku', 'claude-haiku-4-5-20251001', 'thorough')).toBeNull();
    expect(effortFor('anthropic-4.6', 'claude-sonnet-4-6', 'balanced')).toBeNull();
    expect(effortFor('openai-5.6', 'gpt-5.6-terra', 'balanced')).toBe('medium');
    expect(effortFor('google-3', 'gemini-3.5-flash', 'concise')).toBe('minimal');
    expect(effortFor('google-3', 'gemini-3.8-flash', 'concise')).toBe('low');
    expect(effortFor('unknown', 'whatever', 'thorough')).toBeNull();
  });
});
