# Flow Companion extension

The source of the Flow Companion Chrome extension: a Manifest V3 side panel built with WXT, React, TypeScript, and Tailwind. For what the extension does and how to install it, see the [main README](../README.md).

## Requirements

Node 24 (see `.nvmrc`), or 22.18 or later, and npm. There's no backend to run.

The first `npm run e2e`, `npm run icons`, or `npm run screenshots` needs Playwright's Chromium: `npx playwright install chromium`.

## Commands

Run these in `extension/`.

```bash
npm install          # installs dependencies and generates WXT's types in .wxt/
npm run dev          # development build that reloads on change
npm run build        # production build → .output/chrome-mv3/
npm run zip          # Chrome Web Store package → .output/*.zip, with LICENSE.txt and THIRD-PARTY-NOTICES.txt; fails if a demo answer is missing or a placeholder
npm test             # unit tests (Vitest, happy-dom)
npm run lint         # ESLint; dangerouslySetInnerHTML and innerHTML assignments are errors
npm run typecheck    # TypeScript, no emit
npm run e2e          # Playwright specs against the production build; run npm run build first
npm run size         # bundle budget on the build: under 3 MB at startup, under 6 MB in total, no Mermaid or Excalidraw code at startup
npm run pii          # PII scanner over every tracked file
npm run check        # pii, lint, typecheck, test, build, size, e2e: what CI runs
npm run eval         # grounding eval against a real provider (below)
npm run record-demo  # re-records the demo flow's answers from a real provider (below)
npm run links        # checks that every provider page the extension links to still loads; CI runs it weekly
npm run icons        # renders public/icon/*.png from assets/icon.svg
npm run screenshots  # builds with the gallery page, then screenshots every screen → .output/screenshots/ (SCREENSHOTS_DIR overrides)
```

The gallery page (`src/entrypoints/gallery/`) shows every screen of the panel on one page. A plain build leaves it out; `npm run build:gallery` or `WXT_GALLERY=1 npm run dev` includes it. After `npm run screenshots`, run `npm run build` again before you load the build in Chrome or run `npm run size`.

## Grounding eval and demo answers

`npm run eval` sends the cases in `test/fixtures/grounding-eval/` to a real model, including prompt-injection cases, and writes the results to `test/fixtures/`. Run it after any change to the system prompt, the built-in model registry (`src/lib/models.ts`), or a provider adapter, and commit the results.

`npm run record-demo` records the demo flow's answers into `test/fixtures/`. Read them before you commit them: they ship in the package.

Both read their settings from the environment or from a git-ignored `extension/.env.eval`:

- `EVAL_PROVIDER`: `anthropic`, `openai`, or `google`.
- The provider's key: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GOOGLE_API_KEY`.
- `EVAL_MODEL` (optional): a model id such as `claude-sonnet-5`. Without it, the provider's default model is used.

```bash
ANTHROPIC_API_KEY=… EVAL_PROVIDER=anthropic npm run eval
```

Both send real requests, billed to that key.

## Load the production build in Chrome

1. `npm run build`
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose `extension/.output/chrome-mv3/`.
3. Click the Flow Companion icon in Chrome's toolbar. The side panel opens.

The panel's demo flow works without a Salesforce org or an API key.

Before you open a pull request, check your change in this build on a real Flow Builder page.

## Layout

```
extension/
├── wxt.config.ts            # manifest (permissions, hosts, CSP) and Vite plugins
├── src/entrypoints/
│   ├── background.ts        # makes the toolbar icon open the side panel
│   ├── sidepanel/           # the panel: index.html, main.tsx, App.tsx
│   └── gallery/             # every screen on one page, for review and screenshots; not in the store build
├── src/components/          # the panel's UI; ui/ holds the Base UI wrappers
├── src/hooks/               # useActiveFlow, useSettings, useChatStream
├── src/lib/                 # Salesforce client and extractor, providers/, models, prompt assembly, flow size, chat history, settings and keys, diagrams, the demo flow
├── src/prompts/             # the system prompt, loaded by lib/system-prompt.ts
├── src/styles/app.css       # Tailwind 4 and the design tokens, light and dark
├── public/theme.js          # applies the saved theme before first paint (MV3 allows no inline scripts)
├── public/icon/             # 16, 32, 48, 128 px, rendered from assets/icon.svg
├── assets/                  # icon sources
├── test/                    # unit-test setup and fixtures: the synthetic flow, eval cases and results, demo answers
├── e2e/                     # Playwright specs, the extension fixture, and the Salesforce and provider mocks
├── eval/                    # the grounding eval, its matchers, and the demo recorder
└── scripts/                 # bundle size, demo-answer check, third-party notices, link check, icons, screenshots
```
