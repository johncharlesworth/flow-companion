# Security Policy

## Reporting a vulnerability

Please don't open a public issue for a security problem. Email me at **support@getflowcompanion.com** with:

- what you found and where (a file path helps)
- how to reproduce it
- the impact as you see it

You can also report privately on GitHub: on the repository's **Security** tab, choose **Report a vulnerability**.

I'll reply within three business days. I aim to fix issues within 90 days, sooner for serious ones. I'll credit you when the fix ships, unless you'd rather I didn't.

## Supported versions

Fixes go into the latest version in the Chrome Web Store.

## Scope

In scope: the extension (`extension/`), including its system prompt in `extension/src/prompts/`, and the PII scanner in `scripts/`.

Out of scope: the Anthropic, OpenAI, and Google APIs (report those to the provider), Salesforce itself, and social engineering.

## What the extension promises

There's no backend. The extension connects only to your own Salesforce org and to the AI providers you've added a key for. Its content security policy (`extension/wxt.config.ts`) lets the panel connect only to `*.my.salesforce.com` and `*.my.salesforce-setup.com` hosts and to the Anthropic, OpenAI, and Google APIs, and load nothing from outside the extension. The code, not the policy, keeps Salesforce requests to your own org (see 3 below). **Open in Excalidraw** copies the picture to your clipboard and opens excalidraw.com in a new tab. Nothing is sent there until you paste it.

The code refers to these promises as invariants 1 to 7:

1. **No automatic retries.** When a question fails, the panel says what happened and offers **Retry** where retrying can help. The extension never re-sends a question on its own.
2. **No silent trimming.** If the flow and the chat so far are too large for the chosen model, the panel stops before sending. It names a model from the same provider that can read them, or, when none can, another provider to try. The flow and the chat are never trimmed or summarized.
3. **The Salesforce session cookie goes only to your org.** The extension reads it in your browser and sends it only to your org's own `*.my.salesforce.com` host, to call the Tooling API. It never goes to a `*.force.com` host or anywhere else.
4. **API keys stay in `chrome.storage`.** A key is kept in `chrome.storage.local` when **Remember this key on this computer** is on. When it's off, the key is kept in `chrome.storage.session` and forgotten when Chrome closes. A key goes to its provider only in a request header. It never appears in a URL, in chat history, or in the console. Settings shows a saved key only by its last four characters; while you enter a key, the eye button (**Show key**) reveals it.
5. **Answers are sanitized.** The panel renders answers as Markdown with no scripts or images, and only `https://` links are clickable. Diagrams are drawn by Mermaid at its strict security level. Lint forbids `dangerouslySetInnerHTML`, and tests with hostile content run in CI.
6. **Flow content is treated as data.** Every request wraps the flow's JSON in a labeled data block, and the system prompt tells the model to treat it as data, never as instructions. A grounding eval with prompt-injection cases (`extension/eval/`) is re-run on every change to the system prompt, the built-in model registry (`extension/src/lib/models.ts`), or a provider adapter.
7. **No real customer data in the repository.** A PII scanner checks every commit (through the pre-commit hook) and every CI run for anything that looks like a Salesforce ID, org host, email address, Anthropic or OpenAI key, or local file path.

Reports that show a way around any of these are the most valuable.

## Disclosure

I aim for 90 days from acknowledgment to public disclosure, or seven days if the issue is being actively exploited. If no fix has shipped after 90 days and you plan to disclose, please give me seven days' notice.
