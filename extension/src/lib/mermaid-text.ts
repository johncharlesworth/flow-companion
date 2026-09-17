// The pure half of Draw this flow: find the one
// ```mermaid block in an answer, tidy its labels before the renderer sees them,
// count nodes, and check every API-looking name against the flow. No DOM, no
// Mermaid import: the grounding eval and the unit suite run this in Node.

const FENCE = /```mermaid[^\n]*\n([\s\S]*?)\n?```/;

/** The body of the first closed ```mermaid block, trimmed; null when there is none. */
export function extractMermaid(markdown: string): string | null {
  const match = FENCE.exec(markdown);
  return match ? match[1]!.trim() : null;
}

/** True while an answer's ```mermaid fence has opened and not yet closed. */
export function hasOpenMermaidFence(markdown: string): boolean {
  const fences = [...markdown.matchAll(/```[^\n]*/g)];
  const last = fences.at(-1);
  return fences.length % 2 === 1 && !!last && /^```mermaid\b/.test(last[0]);
}

/**
 * While streaming, an unfinished mermaid fence becomes a plain code fence, so
 * nothing tries to draw a half-written diagram (and nothing flashes an error).
 */
export function neutraliseOpenMermaidFence(markdown: string): string {
  if (!hasOpenMermaidFence(markdown)) return markdown;
  const at = markdown.lastIndexOf('```mermaid');
  return `${markdown.slice(0, at)}\`\`\`text${markdown.slice(at + '```mermaid'.length)}`;
}

const HEADER = /^\s*(graph|flowchart)\b.*$/i;
/** `%%{init: …}%%` wherever it sits: Mermaid's own directive regex spans lines and tolerates a missing closer. */
const DIRECTIVE = /%%\{[\s\S]*?\}%%/g;
const OPEN_DIRECTIVE = /%%\{/;
const INTERACTION = /^\s*click\s/;

/** Straight quotes, no quotes, parentheses, semicolons, or tags inside a label, whitespace collapsed. */
function cleanLabel(text: string): string {
  return text
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/<[^>]*>/g, '')
    .replace(/\\"/g, '')
    .replace(/["();]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanLine(line: string): string {
  return (
    line
      // Quoted labels in any shape: A["…"], B{"…"}, C(["…"]), D{{"…"}}, and edge labels |"…"|.
      .replace(/"((?:[^"\\\n]|\\.)*)"/g, (_m, inner: string) => `"${cleanLabel(inner)}"`)
      // Unquoted labels in the three shapes the contract uses; nested shapes ((…)), ([…]) stay untouched.
      .replace(/(?<![[({])\[(?![[(/\\"])([^[\]"\n|]+)\](?!\])/g, (_m, inner: string) => `["${cleanLabel(inner)}"]`)
      .replace(/(?<!\{)\{(?![{"])([^{}"\n|]+)\}(?!\})/g, (_m, inner: string) => `{"${cleanLabel(inner)}"}`)
      .replace(/(?<![([])\((?![[("])([^()"\n|]+)\)(?![)\]])/g, (_m, inner: string) => `("${cleanLabel(inner)}")`)
      // Edge labels: |Yes (all)| → |Yes all|; a quoted one loses its quotes.
      .replace(/\|([^|\n]+)\|/g, (_m, inner: string) => `|${cleanLabel(inner)}|`)
  );
}

/**
 * Tidies a diagram for the renderer: top-down header, clean labels, no
 * directives or click handlers. Directives go first and whole, because a
 * directive can set themeCSS (CSS written into the SVG, which applies to the
 * whole panel); a line still holding an unterminated `%%{` goes too.
 */
export function cleanMermaid(text: string): string {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .replace(DIRECTIVE, '')
    .split('\n')
    .filter((line) => !OPEN_DIRECTIVE.test(line) && !INTERACTION.test(line));
  while (lines.length && !lines[0]!.trim()) lines.shift();
  if (lines.length && HEADER.test(lines[0]!)) lines[0] = 'flowchart TD';
  else lines.unshift('flowchart TD');
  return lines
    .map((line, i) => (i === 0 ? line : cleanLine(line)))
    .filter((line, i) => i === 0 || line.trim())
    .join('\n');
}

const KEYWORDS = new Set(['style', 'classDef', 'class', 'linkStyle', 'click', 'subgraph', 'end', 'direction']);
const ARROW = /<?-{2,}[>xo]?|<?={2,}>?|-\.+->?|~{3,}|&/g;

/** Distinct node ids: what precedes a shape or stands alone between arrows. Labels are not nodes. */
export function countNodes(text: string): number {
  const ids = new Set<string>();
  for (const line of cleanMermaid(text).split('\n').slice(1)) {
    const bare = line.replace(/"[^"]*"/g, '""').replace(/\|[^|]*\|/g, ' ');
    for (const part of bare.split(ARROW)) {
      const id = /^\s*([A-Za-z_][\w-]*)/.exec(part)?.[1];
      if (id && !KEYWORDS.has(id)) ids.add(id);
    }
  }
  return ids.size;
}

const UNDERSCORED = /^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+$/;
const CAMEL = /^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+$/;

/** Words that look like Salesforce API names: Underscored_Names or CamelCase with two or more capitals. */
export function looksLikeApiName(word: string): boolean {
  return word.length >= 4 && (UNDERSCORED.test(word) || CAMEL.test(word));
}

function tokens(text: string): string[] {
  return text.split(/[^\w]+/).filter(Boolean);
}

const LABELLED_ID = /(?<![\w"])([A-Za-z_][\w-]*)\s*(?:\[|\{|\(|>)/g;

/**
 * API-looking names the picture shows: words in labels and edge labels, plus
 * node ids that have no label anywhere (Mermaid prints those as the text).
 * An id that carries a label is never displayed, so it is not checked: a model
 * may call a box CheckType and label it "Check customer type" without inventing
 * anything. In order of first appearance, once each.
 */
export function identifiersIn(diagram: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (word: string) => {
    if (looksLikeApiName(word) && !seen.has(word)) {
      seen.add(word);
      out.push(word);
    }
  };
  const body = diagram.split('\n').slice(1);
  const labelled = new Set<string>();
  for (const line of body) for (const m of line.matchAll(LABELLED_ID)) labelled.add(m[1]!);
  for (const line of body) {
    // Displayed text: quoted labels and |edge labels|.
    for (const m of line.matchAll(/"([^"]*)"|\|([^|\n]+)\|/g)) for (const word of tokens(m[1] ?? m[2] ?? '')) add(word);
    // Bare ids: what is left once labels are blanked, split at arrows.
    const bare = line.replace(/"[^"]*"/g, '""').replace(/\|[^|]*\|/g, ' ');
    for (const part of bare.split(ARROW)) {
      const id = /^\s*([A-Za-z_][\w-]*)/.exec(part)?.[1];
      if (id && !KEYWORDS.has(id) && !labelled.has(id)) add(id);
    }
  }
  return out;
}

/** Every API-looking token anywhere in the flow's JSON strings, plus every `name`. */
export function flowIdentifiers(flow: unknown): Set<string> {
  const names = new Set<string>(['Start', 'End']);
  const walk = (value: unknown) => {
    if (typeof value === 'string') {
      for (const word of tokens(value)) if (looksLikeApiName(word)) names.add(word);
    } else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        if (key === 'name' && typeof v === 'string') names.add(v);
        walk(v);
      }
    }
  };
  walk(flow);
  return names;
}

/** Splits a diagram's API-looking names into those the flow has and those it does not. */
export function checkIdentifiers(diagram: string, flow: unknown): { known: string[]; unknown: string[] } {
  const names = flowIdentifiers(flow);
  const known: string[] = [];
  const unknown: string[] = [];
  for (const id of identifiersIn(diagram)) (names.has(id) ? known : unknown).push(id);
  return { known, unknown };
}
