import { harden } from 'rehype-harden';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { ComponentProps } from 'react';
import { Streamdown } from 'streamdown';

import { codeHighlighter } from '@/lib/code-highlighter';
import { neutraliseOpenMermaidFence } from '@/lib/mermaid-text';

import { DiagramContext, type DiagramHandlers, FlowDiagram } from './FlowDiagram';

// Sanitised markdown for model output (invariant 5). Streamdown with
// an EXPLICIT rehype pipeline: raw HTML is parsed, then sanitised against a
// schema with no images and https-only link protocols, then hardened, which
// drops script and data links. Sanitize lets a relative link through (it has
// no protocol to refuse), and in a side panel that opens the extension's own
// pages, so the link renderer below keeps only https:// links clickable and
// renders any other as its words. The defaults are not relied on; the pipeline
// is snapshot-tested so a dropped step fails CI.
//
// Diagrams: every ```mermaid block goes to FlowDiagram through Streamdown's
// custom-renderer slot (not its built-in Mermaid block, whose pan-zoom layer
// captures the wheel and the pointer and would hijack scrolling in a side
// panel). While an answer streams, an unfinished mermaid fence is shown as
// plain code, so nothing tries to draw half a diagram.

/** The sanitize schema: rehype-sanitize's default minus images, links https only. */
export const flowChatSchema = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter((t) => t !== 'img' && t !== 'input'),
  protocols: { ...defaultSchema.protocols, href: ['https'] },
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), ['target', '_blank'], ['rel', 'noreferrer']],
  },
};

// A named prefix ('https://') needs a default origin: without one harden throws on its first use
// and never runs; with one it blocks every link, because a prefix means one site. The wildcard is the only way to say "any https site"; the renderer below narrows it.
// 'text-only': a refused link is its words. The default, 'indicator', prints "[blocked]" after every
// email address and http link, and after each https link while its address is still streaming in.
export const HARDEN_OPTIONS = { allowedLinkPrefixes: ['*'], allowedImagePrefixes: [] as string[], allowDataImages: false, allowedProtocols: ['https'], linkBlockPolicy: 'text-only' as const };

export const REHYPE_PLUGINS = [rehypeRaw, [rehypeSanitize, flowChatSchema], [harden, HARDEN_OPTIONS]] as const;

const components: NonNullable<ComponentProps<typeof Streamdown>['components']> = {
  // Only an absolute https link is clickable; a relative one, or anything else, is its words.
  a: ({ href, children, node: _node, ...rest }) =>
    typeof href === 'string' && href.startsWith('https://') ? (
      <a href={href} target="_blank" rel="noreferrer" {...rest}>
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
};

const PLUGINS: NonNullable<ComponentProps<typeof Streamdown>['plugins']> = { code: codeHighlighter, renderers: [{ language: 'mermaid', component: FlowDiagram }] };
const NO_HANDLERS: DiagramHandlers = {};

export function SanitizedMarkdown({ markdown, streaming = false, diagram = NO_HANDLERS }: { markdown: string; streaming?: boolean; diagram?: DiagramHandlers }) {
  return (
    <DiagramContext value={diagram}>
      <Streamdown
        className="answer"
        mode={streaming ? 'streaming' : 'static'}
        isAnimating={streaming}
        animated={false}
        caret="block"
        controls={false}
        lineNumbers={false}
        linkSafety={{ enabled: false }}
        rehypePlugins={[...REHYPE_PLUGINS] as never}
        plugins={PLUGINS}
        shikiTheme={['github-light', 'github-dark']}
        components={components}
      >
        {streaming ? neutraliseOpenMermaidFence(markdown) : markdown}
      </Streamdown>
    </DiagramContext>
  );
}
