# Flow Companion for Salesforce

Open a Flow in Flow Builder, click the toolbar icon, and chat about that flow with the AI model of your choice, using your own API key.

Flow Companion is a Chrome side-panel extension for everyday Salesforce admins. It reads the flow's last saved metadata through your org's Tooling API, using the Salesforce session you already have, sends it to Anthropic, OpenAI, or Google under your key, and streams the answer back. There is no backend, no account, no telemetry, and nothing to pay us. It explains; it never edits your flow.

Website and documentation: [getflowcompanion.com](https://getflowcompanion.com) · [Docs](https://getflowcompanion.com/docs/) · [Privacy policy](https://getflowcompanion.com/privacy.html)

> Status: v1.0 in development. The Chrome Web Store listing is not live yet.

## What you can do

- **Ask anything** about the open flow: "What does this flow do?", "Which record updates happen on the SMB path?", "Why would this fault?"
- **Overview** — a fixed-shape summary: purpose, trigger and entry criteria, main paths by outcome, data written by object, external calls, worth knowing.
- **Explain an element** — pick any element from the searchable outline and get its inputs, logic quoted verbatim, outcomes, and fault path.
- **Document this flow** — a full document with resource tables, a walkthrough in execution order, a decision matrix, and data operations, with Copy and Download.
- **Draw this flow** — one flowchart of the main paths, drawn for business readers, with Open in Excalidraw to edit it. Draw every element by name, or draw from one element onward.
- **Your own instructions** — "I'm a junior admin, define jargon", "Answer in Portuguese", plus a Concise / Balanced / Thorough setting.
- **Your choice of model** — every model your key can use, with recommended defaults per provider. Switch mid-chat.
- **History per flow** on this computer, kept across tab switches and new versions. New chat clears it.

Answers are grounded in the flow's metadata. The flow's JSON is treated as untrusted data: text inside a flow cannot change how the assistant behaves, and a grounding eval with prompt-injection fixtures (`extension/eval/`) runs on any change to the prompt, the models, or the adapters.

## How it works

```
Salesforce tab ──[session cookie, read locally]──> Side panel
                                                     ├─[Tooling API]──> your Salesforce org
                                                     └─[your key]────> api.anthropic.com | api.openai.com | generativelanguage.googleapis.com
```

1. You open a Flow in Flow Builder and click the toolbar icon.
2. The panel reads your org's session cookie locally and asks your org's Tooling API for the flow's last saved version. The cookie goes to your org's own `*.my.salesforce.com` host and nowhere else.
3. Your question and the flow's metadata go straight from your browser to the provider you picked, under your key. Follow-up questions in the same chat reuse the flow through the provider's own caching, so they cost much less than the first.

Nothing leaves your browser except those two connections. The manifest's content security policy makes Chrome enforce it.

## What is sent

When you ask a question, exactly two things go to the AI provider you chose, under your key: the flow's **saved metadata** (the same definition Salesforce stores for the flow: element names and labels, decision conditions, formulas, assignments, text templates, descriptions, and the connections between elements) and your **conversation** so far. No records, no field data from your org, no user information, and nothing from other tabs. The flow is wrapped and labelled as data, so text inside a flow cannot instruct the model. The provider's own privacy terms apply to what it receives; see the [privacy policy](https://getflowcompanion.com/privacy.html).

## What you need

- Chrome 114 or later (the side panel API).
- A Salesforce org where your profile has **API Enabled** and the org does not use API Access Control.
- An API key from [Anthropic](https://console.anthropic.com/), [OpenAI](https://platform.openai.com/), or [Google AI Studio](https://aistudio.google.com/). A Claude Pro, ChatGPT Plus, or Gemini Advanced subscription is not an API key; you pay the provider for what you use, at their rates, and manage spend in their console.

## Documented limitations

Orgs with API Access Control, and orgs behind Microsoft Defender for Cloud Apps (MCAS), are not supported. The extension reads the last **saved** version, so save before you ask about a change. A flow larger than the chosen model's window is stopped before sending, with a one-click switch to a model that fits. A new API key can start on a small allowance, so a large flow or a quick run of questions may be refused at first; the error says what to do. Firefox is not supported. Two Chrome windows on the same flow share one chat history. Draw this flow draws only this flow: approval processes, other flows, and anything else outside its saved definition are not in the picture, because they are not in the data.

The extension does not lint or fix flows. For rules-based checks, use Lightning Flow Scanner.

## Install

**Chrome Web Store:** coming at v1.0.0.

**From source:** clone the repo, then

```bash
cd extension && npm install && npm run build
```

and load `extension/.output/chrome-mv3/` as an unpacked extension from `chrome://extensions` (Developer mode → Load unpacked). Full commands, tests, and layout are in [`extension/README.md`](./extension/README.md).

## Project

This repository holds the extension's source, its tests, its grounding eval, and its CI. This repository receives a snapshot at each release, so it carries no day-to-day history. Issues and pull requests are welcome here; see [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`SECURITY.md`](./SECURITY.md).

Open source under the GPL-3.0 licence. See [`LICENSE`](./LICENSE); the name and mark are not part of the licence, see [`TRADEMARKS.md`](./TRADEMARKS.md).

Salesforce and Flow Builder are trademarks of Salesforce, Inc. Flow Companion is an independent product and is not affiliated with or endorsed by Salesforce.
