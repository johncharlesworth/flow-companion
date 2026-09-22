# Flow Companion extension

The Chrome side-panel extension: the v1.0 build.

## Prerequisites

Node 24 (see `.nvmrc`; 22.18 or later also works, because the two helper scripts rely on Node's built-in TypeScript stripping) and npm. Nothing else: there is no backend.

## Commands

```bash
npm install          # also runs `wxt prepare` (generates .wxt/ types)
npm run dev          # WXT dev build with reload
npm run build        # production build → .output/chrome-mv3/
npm run zip          # the store package → .output/*.zip, with LICENSE.txt and THIRD-PARTY-NOTICES.txt inside; refuses while the demo answers are placeholders
npm test             # Vitest unit tests (happy-dom, fake browser APIs)
npm run lint         # ESLint 10, flat config; @eslint-react/dom-no-dangerously-set-innerhtml is an error (no eslint-plugin-react: it crashes on ESLint 10)
npm run typecheck    # tsc --noEmit
npm run e2e          # Playwright specs (smoke, tab following, chat with a paced SSE mock, demo, draw) against the production build
npm run eval         # grounding eval against a real provider; reads the gitignored extension/.env.eval (EVAL_PROVIDER=anthropic, ANTHROPIC_API_KEY=…, EVAL_MODEL optional) or the environment; results → test/fixtures/
npm run record-demo  # re-record the demo flow's answers with a real key (.env.eval)
npm run size         # bundle budget on .output/chrome-mv3/: startup files under 3 MB, whole package under 6 MB, no mermaid/excalidraw chunk at startup
npm run links        # every provider page the product links to still answers (weekly in CI, and before a release)
npm run pii          # PII scanner over every tracked file (what CI runs)
npm run check        # all of the above, in CI order
npm run icons        # re-render public/icon/*.png from assets/icon.svg
npm run screenshots  # builds with the gallery page included, then contact sheets of every screen → .output/screenshots/ (SCREENSHOTS_DIR overrides)
```

The gallery page (`src/entrypoints/gallery/`) is left out of a plain build so the installed package holds only the panel and its background script; `WXT_GALLERY=1 npm run dev` or `npm run build:gallery` includes it. After `npm run screenshots`, run `npm run build` again before loading the build in Chrome or running `npm run size`.

The first `npm run e2e` (or `npm run icons`) needs Playwright's Chromium: `npx playwright install chromium`.

## Load the production build in Chrome

1. `npm run build`
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick `extension/.output/chrome-mv3/`.
3. Click the toolbar icon on any tab; the side panel opens.

Every change ends with this check on a real Flow Builder page; unit tests do not catch a broken production render.

## Layout

```
extension/
├── wxt.config.ts            # manifest (permissions, hosts, CSP) and Vite plugins
├── src/entrypoints/
│   ├── background.ts        # one call: the toolbar icon opens the panel
│   └── sidepanel/           # index.html, main.tsx, App.tsx
├── src/styles/app.css       # Tailwind 4 (CSS-first) + the design tokens, light and dark
├── src/components/          # header, states, settings, model menu, transcript, composer, element list, sanitised markdown; ui/ holds the Base UI wrappers
├── src/lib/                 # Salesforce client and extractor, models, size and stop, providers/, prompt assembly, history, settings and keys
├── src/hooks/               # useActiveFlow, useSettings, useChatStream
├── src/prompts/             # the system prompt (verbatim), loaded by lib/system-prompt.ts
├── src/entrypoints/gallery/ # unlisted page rendering every screen for review and screenshots
├── public/theme.js          # applies the remembered theme before first paint (MV3 forbids inline scripts)
├── test/setup.ts            # jest-dom matchers + fake browser reset
├── e2e/                     # Playwright specs (smoke, active-flow, chat, chat-more, demo, tooltips, draw) + extension fixture, Salesforce mock, in-page provider mock
├── scripts/                 # bundle-size check, icon renderer
├── assets/icon.svg          # icon source; public/icon/*.png are rendered from it
└── public/icon/             # 16, 32, 48, 128 px
```
