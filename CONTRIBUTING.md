# Contributing

Thanks for considering a contribution. This is a small, focused project: chat about the Flow you have open. We say no to scope creep so the product stays easy for everyday admins.

This repository receives a snapshot at each release, so it carries no day-to-day history. Issues and pull requests are read here and folded into the next release; a merged change appears with that release rather than as its own commit.

## Filing issues

- **Bugs:** include the extension version, the Chrome version, which provider and model you used, and what the panel said. If a flow is involved, say roughly how large it is; never paste a real flow or real record data into an issue.
- **Feature requests:** describe the situation before the proposed UI.
- **Security issues:** never as a public issue. See [`SECURITY.md`](./SECURITY.md).

## Pull requests

1. Open an issue first for anything beyond a small fix, so the approach is agreed before code is written.
2. Branch from `main`; one change per PR; small conventional commits (`feat(ext): …`, `fix(ext): …`, `docs: …`).
3. Tests first for anything pure (parsers, the registry, prompt assembly, the size estimate). Run `npm run check` in `extension/` before opening the PR; it runs the PII scan, lint, typecheck, unit tests, build, bundle-size check, and the Playwright specs in CI order.
4. Any change to the system prompt, the model registry, or a provider adapter must be accompanied by a re-run of the grounding eval (`npm run eval`) with the results committed.
5. The PII scanner blocks real Salesforce ids, tenant hosts, provider keys, and local paths. `--no-verify` is not acceptable. If the scanner flags a synthetic literal, add it to `scripts/pii-allowlist.txt` with a one-line explanation of why it is synthetic.
6. Contributions are accepted under the project's licence, GPL-3.0, on the same terms as the rest of the code, and you keep the copyright to what you write. By opening a pull request you confirm you have the right to contribute what you send.

## Scope

The extension explains a flow and never changes Salesforce, keeps no backend and no telemetry, and holds to the seven invariants in [`SECURITY.md`](./SECURITY.md). Proposals that move outside that are best raised as an issue first, so nobody builds something that cannot land.

## Style

TypeScript strict; functional React with hooks; Tailwind tokens from `src/styles/app.css` only; comments only where the *why* is not obvious. Copy is for everyday Salesforce admins and names the provider (Anthropic, OpenAI, Google) rather than saying "the API".

## Code of conduct

Be excellent to each other. Disagree on substance, never on identity.
