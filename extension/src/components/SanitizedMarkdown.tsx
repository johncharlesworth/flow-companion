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
// schema with no images and https-only links, then hardened so nothing can
// link anywhere but https. The defaults are not relied on; the pipeline is
// snapshot-tested so a dropped step fails CI.
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

export const HARDEN_OPTIONS = { allowedLinkPrefixes: ['https://'], allowedImagePrefixes: [] as string[], allowDataImages: false, allowedProtocols: ['https'] };

export const REHYPE_PLUGINS = [rehypeRaw, [rehypeSanitize, flowChatSchema], [harden, HARDEN_OPTIONS]] as const;

const components: NonNullable<ComponentProps<typeof Streamdown>['components']> = {
  a: ({ href, children, ...rest }) => (
    <a href={href} target="_blank" rel="noreferrer" {...rest}>
      {children}
    </a>
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
