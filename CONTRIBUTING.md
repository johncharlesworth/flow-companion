# Contributing

Thanks for considering a contribution. Flow Companion is a small, focused project: chat about the Flow you have open.

Issues and pull requests are welcome. This repository is updated once per release, as a single commit, so an accepted pull request isn't merged on its own: its changes arrive with the next release, and that release's notes on GitHub name everyone whose changes it includes.

## Scope

Flow Companion reads a flow and explains it. It never changes anything in Salesforce, has no backend, and collects no telemetry. Every change must keep the seven invariants in [`SECURITY.md`](./SECURITY.md). For anything outside that, open an issue before you write code.

## Filing issues

- **Bugs:** include the extension version (shown on `chrome://extensions`), your Chrome version, the provider and model you used, and what the panel said. If a flow is involved, say roughly how many elements it has. Never paste or attach a real flow (including a **Download JSON** file) or real record data.
- **Feature requests:** describe what you're trying to do, then the UI you have in mind.
- **Security issues:** never as a public issue. See [`SECURITY.md`](./SECURITY.md).

## Setup

You need Node 24 (22.18 or later works) and npm.

```bash
bash scripts/install-git-hooks.sh   # installs the pre-commit PII check
cd extension
npm install
npx playwright install chromium     # once, for the Playwright specs
npm run build
```

Load `extension/.output/chrome-mv3/` from `chrome://extensions` (**Developer mode** → **Load unpacked**). With no Salesforce org, use the demo flow: **See it on a demo flow first** on the panel's first screen, or **Try a demo flow** at the bottom of Settings. [`extension/README.md`](./extension/README.md) describes the other commands.

## Pull requests

1. For anything bigger than a small fix, open an issue first to agree on the approach.
2. Branch from `main`. One change per pull request, in small conventional commits (`feat(ext): …`, `fix(ext): …`, `docs: …`).
3. Write tests first for anything pure (parsers, the model registry, prompt assembly, the size estimate).
4. Run `npm run check` in `extension/` before you open the pull request. It runs the PII scan, lint, typecheck, unit tests, build, bundle-size check, and Playwright specs, in CI order.
5. Try the production build in Chrome on a real Flow Builder page or the demo flow.
6. If you change the system prompt (`extension/src/prompts/`), the model registry (`extension/src/lib/models.ts`), or a provider adapter (`extension/src/lib/providers/`), re-run the grounding eval with `npm run eval` and commit the results. It needs your own API key; see [`extension/README.md`](./extension/README.md).
7. Contributions are licensed under GPL-3.0, like the rest of the code, and you keep the copyright to what you write. By opening a pull request, you confirm you have the right to contribute it.

## The PII scanner

The pre-commit hook blocks a commit, and CI fails, when a file contains anything that looks like a Salesforce ID, org host, email address, Anthropic or OpenAI key, or local file path, or when a blocked file such as `.DS_Store` is added. The scanner matches patterns: it can't tell a real value from a made-up one. Don't bypass the hook with `--no-verify`. If it flags a value you made up for a test, add that value to `scripts/pii-allowlist.txt` on its own line, with a `#` comment line above it saying it's synthetic.

## Style

TypeScript strict, functional React with hooks, and Tailwind tokens from `extension/src/styles/app.css` only. Add a comment only where the reason for the code isn't obvious. Copy is for everyday Salesforce admins and names the provider (Anthropic, OpenAI, Google) instead of saying "the API".

## Code of conduct

Be excellent to each other. Disagree on substance, never on identity.
