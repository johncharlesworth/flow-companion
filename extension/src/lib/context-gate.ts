// Hard pre-send context stop (invariant 2: no silent truncation). Pure: given
// the pieces of the next request and the model's input limit, decide whether
// the send must be blocked, and name the smallest model on the same provider
// that would fit. The 5,000-token margin covers per-turn overhead only; the
// flow and the assembled turn are measured, not guessed, wherever a provider
// offers a count endpoint (flow-size.ts).

export const SAFETY_MARGIN_TOKENS = 5_000;

export interface ContextGateCandidate {
  id: string;
  label: string;
  maxInputTokens: number;
}

export interface ContextGateInput {
  /** The current model's input limit (registry, overridden by the live list). */
  maxInputTokens: number;
  systemTokens: number;
  flowTokens: number;
  transcriptTokens: number;
  /** Measured on the string modes.ts produces for this turn. */
  assembledTurnTokens: number;
  /** The value the adapter will send as the output limit. */
  maxOutputTokens: number;
  /** Other models on the same provider the key can use. */
  candidates?: ContextGateCandidate[];
  currentModelId?: string;
}

export type ContextGateResult =
  | { ok: true; totalTokens: number }
  | { ok: false; totalTokens: number; limit: number; suggested: ContextGateCandidate | null };

export function shouldBlockSend(input: ContextGateInput): ContextGateResult {
  const totalTokens =
    input.systemTokens + input.flowTokens + input.transcriptTokens + input.assembledTurnTokens + input.maxOutputTokens;
  const needed = totalTokens + SAFETY_MARGIN_TOKENS;
  if (needed <= input.maxInputTokens) return { ok: true, totalTokens };
  const suggested =
    [...(input.candidates ?? [])]
      .filter((c) => c.id !== input.currentModelId && needed <= c.maxInputTokens)
      .sort((a, b) => a.maxInputTokens - b.maxInputTokens)[0] ?? null;
  return { ok: false, totalTokens, limit: input.maxInputTokens, suggested };
}
