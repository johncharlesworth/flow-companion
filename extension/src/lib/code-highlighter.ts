// A Streamdown code highlighter built on Shiki's core with only the grammars
// answers need (json, apex; anything else renders as plain text) and the
// JavaScript regex engine: no WASM (the MV3 CSP forbids it) and no 300
// grammar chunks in the bundle.

import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript';
import type { CodeHighlighterPlugin, HighlightOptions } from 'streamdown';
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';

const LANGS = ['json', 'apex'] as const;
type Lang = (typeof LANGS)[number];
const THEMES: [string, string] = ['github-light', 'github-dark'];

/** Streamdown's HighlightResult, which it does not export. */
type HighlightResult = NonNullable<ReturnType<CodeHighlighterPlugin['highlight']>>;

let highlighterPromise: Promise<HighlighterCore> | null = null;
let highlighter: HighlighterCore | null = null;

function load(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [import('@shikijs/themes/github-light'), import('@shikijs/themes/github-dark')],
    langs: [import('@shikijs/langs/json'), import('@shikijs/langs/apex')],
    engine: createJavaScriptRegexEngine(),
  }).then((h) => (highlighter = h));
  return highlighterPromise;
}

function isLang(language: string): language is Lang {
  return (LANGS as readonly string[]).includes(language);
}

/** Plain tokens: one line per token, no colour. */
function plain(code: string): HighlightResult {
  return { tokens: code.split('\n').map((line) => [{ content: line }]) };
}

function tokenize(h: HighlighterCore, options: HighlightOptions): HighlightResult {
  const lang = String(options.language).toLowerCase();
  if (!isLang(lang)) return plain(options.code);
  const result = h.codeToTokens(options.code, { lang, themes: { light: THEMES[0], dark: THEMES[1] } });
  return {
    bg: result.bg,
    fg: result.fg,
    rootStyle: result.rootStyle,
    tokens: result.tokens.map((line) => line.map((t) => ({ content: t.content, color: t.color, bgColor: t.bgColor, htmlStyle: t.htmlStyle, offset: t.offset }))),
  };
}

export const codeHighlighter: CodeHighlighterPlugin = {
  name: 'shiki',
  type: 'code-highlighter',
  getSupportedLanguages: () => [...LANGS] as never,
  getThemes: () => THEMES as never,
  supportsLanguage: (language) => isLang(String(language).toLowerCase()),
  highlight(options, callback) {
    if (highlighter) return tokenize(highlighter, options);
    void load()
      .then((h) => callback?.(tokenize(h, options)))
      .catch(() => callback?.(plain(options.code)));
    return null;
  },
};
