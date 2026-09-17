# Security Policy

## Reporting a vulnerability

Please do not file a public issue for a security problem. Email the maintainer:

- support@getflowcompanion.com

Include what you found and where (a file path helps), how to reproduce it, and your view of the impact. Expect an acknowledgement within three business days and a fix within 90 days, sooner for anything serious. You will be credited in the release notes unless you prefer not to be.

## Scope

In scope: everything under `extension/` (the Chrome extension), the system prompt in `extension/src/prompts/`, and the PII scanner under `scripts/`.

Out of scope: the providers' APIs (report to Anthropic, OpenAI, or Google), Salesforce itself, and social engineering of the maintainer.

## What the extension promises

There is no backend. The only network connections the extension makes are to your own Salesforce org's Tooling API and to the AI provider you chose. Seven invariants are the load-bearing security properties:

1. **Never auto-retry with the user's key.** Every failure is shown to the user with a next action; the extension never retries on its own.
2. **No silent truncation.** A flow that does not fit the chosen model is stopped before sending; the flow and the transcript are never trimmed or summarised.
3. **The Salesforce session cookie only ever goes to `*.my.salesforce.com` / `*.my.salesforce-setup.com` Tooling hosts.** Never to `.force.com`, never off the machine. The manifest's `connect-src` makes the browser enforce this, and its `default-src 'self'` means the panel loads nothing else (images, fonts, frames) from any host.
4. **API keys live only in `chrome.storage`** (local, or session storage when "Remember this key on this computer" is off). Never in URLs, rendered text, chat history, or the console.
5. **No `dangerouslySetInnerHTML` for any model-, provider-, or flow-derived string.** Markdown is sanitised through an explicit pipeline (no images, https links only) and lint forbids the escape hatch. A hostile-content test suite runs on every commit.
6. **Flow JSON is untrusted data.** It is wrapped as data in every request and the system prompt says so; a grounding eval with prompt-injection fixtures runs on any change to the prompt, models, or adapters.
7. **The PII scanner runs on every commit and in CI.** Real customer data never enters the repository.

Reports that show a way around any of these are the most valuable ones.

## Review log

- **2026-09-05, before v1.0.0.** One pass over a written checklist: API keys end to end (storage areas, request headers, never in a URL, a log, a rendered string, or the chat history; the build output grepped for key shapes); the Salesforce session path (host validation before the cookie is read, `connect-src`, id validation before any SOQL or path); Mermaid strict mode and the `DOMParser` adoption of its SVG; the Excalidraw clipboard write; the npm overrides; answers that keep running when the view changes; every place flow or model text is rendered; data at rest; the manifest and CSP; what a Web Store reviewer will ask. **Changed:** a `%%{init}%%` directive inside a drawn diagram can no longer restyle the panel (directives are stripped wherever they sit, and the theme keys are locked in Mermaid's `secure` list); New chat and Forget everything cancel a transcript write still queued by the throttled writer, so a cleared chat stays cleared; the CSP gained `default-src 'self'`, `style-src 'self' 'unsafe-inline'`, and `img-src 'self' data:`, with a Playwright fixture that fails any spec on a violation; the development gallery page left the package; both downloads name their file through one sanitiser.

## Disclosure

Best effort: 90 days from acknowledgement to public disclosure, or seven days if the issue is being exploited. If no fix has shipped after 90 days and you believe disclosure is the responsible course, please give seven days' notice.
