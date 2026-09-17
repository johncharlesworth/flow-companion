// Quick actions and prompt assembly. A quick action
// is one-off per message: it changes what the next user turn asks for, never
// the system prompt. Templates are repo-authored; the flow text never touches
// them. History stores `sentText` so replay is byte-identical.

import type { ChatMode, DrawVariant } from './chat-history';

export type { ChatMode, DrawVariant };

export const RESPONSE_CONTRACTS: Record<Exclude<ChatMode, 'ask' | 'draw'>, string> = {
  overview: `Write an overview of this flow with exactly these sections, in this order, as Markdown headings: Purpose · Trigger and entry criteria · Main paths (name each by its outcome) · Data written (by object) · External calls · Worth knowing. 200–400 words. Use exact element names.`,
  explain: `Explain the element in <focus_element> with exactly these sections: Header (type, label, API name) · Reached from · Inputs it reads · Logic (quote conditions and formulas verbatim) · Outcomes and next element · Fault path (or "none") · Notes. 150–300 words.`,
  document: `Write complete documentation for this flow with these sections as Markdown headings: a metadata table (label, API name, type, trigger, object, status, version) · Purpose · Trigger · Resources (tables for variables, formulas, constants, text templates, choices) · Walkthrough in execution order · Decision matrix · Data operations table · Fault handling · Assumptions and unknowns. Use tables where listed. Be complete; length follows the flow.`,
};

/**
 * Draw this flow: one Mermaid flowchart, top-down
 * for a narrow panel, every node a real element or outcome. The variant sentence
 * sets the audience; the rules are shared.
 */
const DRAW_RULES = `Answer with exactly one \`\`\`mermaid code block containing a flowchart TD, then two or three sentences on what the picture shows. Diagram rules: every box or diamond corresponds to a real element or decision outcome in the flow, nothing invented; node ids are short identifiers such as A, B, C1 with the label in double quotes, for example A["Checks the account type"]; decisions are diamonds, for example B{"Enterprise account?"}; an edge may carry a short outcome label in pipes, for example B -->|Yes| C; no subgraphs, no HTML in labels, no parentheses, quotes, or semicolons inside labels. An outcome or element with no connector simply has no outgoing edge; never add a placeholder box for a missing target.`;

const DRAW_VARIANT_RULE: Record<DrawVariant, string> = {
  business: 'Pitch it at a business reader: 8 to 15 nodes in total, counting every box and diamond, plain-language labels, no API names. When the flow has more steps than that, merge consecutive checks or steps into one box rather than adding nodes, so the main paths stay clear.',
  admins: 'Show every element by its API name, one node per element in execution order, with each decision outcome as an edge label and fault paths as edges labelled Fault.',
  fromElement: 'Draw the element in <focus_element> and what surrounds it: the elements that lead into it, the element itself, and where each of its outcomes goes, following each path for two or three elements and stopping where paths rejoin or the flow ends. One node per element, labelled by API name, each decision outcome as an edge label. Do not draw the rest of the flow.',
};

export function drawContract(variant: DrawVariant): string {
  return `${DRAW_RULES} ${DRAW_VARIANT_RULE[variant]}`;
}

export const DEFAULT_QUESTION: Record<ChatMode, string> = {
  ask: '',
  overview: 'Give me an overview of this flow.',
  explain: 'Explain this element.',
  document: 'Document this flow.',
  draw: 'Draw this flow.',
};

/**
 * Starter questions in the quick-actions menu (Ask, not a formal action): the
 * questions an admin should be asking and may not think to (three added
 * in a real-Chrome check). Plain words; the edits
 * rule governs the answers.
 */
export const STARTER_QUESTIONS = ['Walk me through the main logic', 'What would you simplify, and why?', 'Where could this flow go wrong?', 'What should someone know before changing this flow?'] as const;

export const PREFERENCES_MAX = 1_500;

export interface FocusElement {
  name: string;
  json: unknown;
  /** API names of the elements that connect into it. */
  before: string[];
  /** API names it connects out to. */
  after: string[];
}

export interface AssembleArgs {
  mode: ChatMode;
  /** Draw only; defaults to business. */
  variant?: DrawVariant;
  question: string;
  focusElement?: FocusElement;
  preferences?: string;
}

export interface AssembledTurn {
  /** Sent to the model (the flow block is injected separately by the adapter). */
  sentText: string;
  /** Shown in the transcript; empty for a quick action with nothing typed. */
  displayText: string;
}

const stripClosingTags = (text: string) => text.replace(/<\/?(response_contract|focus_element|response_preferences|user_question|flow_metadata_json)[^>]*>/gi, '');

export function focusElementBlock(focus: FocusElement): string {
  const json = JSON.stringify(focus.json, null, 2);
  const before = focus.before.length ? focus.before.join(', ') : 'none';
  const after = focus.after.length ? focus.after.join(', ') : 'none';
  return `<focus_element name="${focus.name}">\n${json}\nReached from: ${before}\nConnects to: ${after}\n</focus_element>`;
}

export function assembleUserTurn({ mode, variant = 'business', question, focusElement, preferences }: AssembleArgs): AssembledTurn {
  const typed = question.trim();
  const withFocus = focusElement && ((mode === 'explain') || (mode === 'draw' && variant === 'fromElement'));
  const asked =
    typed ||
    (withFocus && mode === 'explain' ? `Explain ${focusElement.name}.` : withFocus && mode === 'draw' ? `Draw this flow around ${focusElement.name}.` : DEFAULT_QUESTION[mode]);
  const prefs = (preferences ?? '').trim();
  const parts: string[] = [];
  if (mode === 'draw') parts.push(`<response_contract mode="draw" variant="${variant}">\n${drawContract(variant)}\n</response_contract>`);
  else if (mode !== 'ask') parts.push(`<response_contract mode="${mode}">\n${RESPONSE_CONTRACTS[mode]}\n</response_contract>`);
  if (withFocus) parts.push(focusElementBlock(focusElement));
  if (prefs) parts.push(`<response_preferences>\n${stripClosingTags(prefs).slice(0, PREFERENCES_MAX)}\n</response_preferences>`);
  if (parts.length === 0) return { sentText: asked, displayText: typed };
  parts.push(`<user_question>\n${asked}\n</user_question>`);
  return { sentText: parts.join('\n'), displayText: typed };
}

/** Output reservation per turn. */
export function maxOutputTokensFor(mode: ChatMode): number {
  return mode === 'document' ? 48_000 : 16_000;
}

/** Document answers cap OpenAI reasoning at medium. */
export function capEffortForMode(effort: string | null, mode: ChatMode, family: string): string | null {
  if (effort === null) return null;
  if (mode === 'document' && family.startsWith('openai') && (effort === 'high' || effort === 'xhigh' || effort === 'max')) return 'medium';
  return effort;
}
