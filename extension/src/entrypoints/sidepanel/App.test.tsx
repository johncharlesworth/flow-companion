import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { setProviderKey } from '@/lib/key-storage';
import { defaultSettings } from '@/lib/settings';

import { OUTLINE_HINT, RECORDED_OUTLINE_HINT } from '@/components/ChatView';

import { App } from './App';

const RECORDED_OVERVIEW = 'This flow routes accounts by tier and then creates a follow-up task.';

// The keyless demo's real adapter, with an answer of the test's own and no
// waiting: the bundled answers change whenever they are re-recorded.
vi.mock('@/lib/providers/recorded', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/providers/recorded')>();
  return {
    ...real,
    recordedProvider: (lookup: Parameters<typeof real.recordedProvider>[0]) =>
      real.recordedProvider(lookup, { firstMs: 0, everyMs: 0, chars: 14 }, async () => ({ overview: RECORDED_OVERVIEW, document: '', draw: '', explain: {} })),
  };
});

async function readyAnthropic() {
  const s = defaultSettings();
  await fakeBrowser.storage.local.set({
    settings: { ...s, activeProvider: 'anthropic', keys: { ...s.keys, anthropic: { status: 'validated', last4: 'wxyz', models: [{ id: 'claude-sonnet-5' }], checkedAt: 1 } } },
  });
  await setProviderKey('anthropic', 'test-key-wxyz', 'local');
}

describe('App', () => {
  it('shows the skeleton until settings are known', () => {
    render(<App />);
    expect(screen.getByLabelText('Reading the flow')).toBeInTheDocument();
  });

  it('with no working key, "Set up your AI" wins over every tab state', async () => {
    const win = (await fakeBrowser.windows.create({ focused: true }))!;
    await fakeBrowser.tabs.create({ windowId: win.id, url: 'https://example.com/', active: true });
    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Set up your AI'));
    expect(screen.queryByText(/Open a Salesforce org/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Flow Companion');
    // The way to try it before getting a key: the demo flow, in a tab of its own.
    const sample = screen.getByRole('link', { name: 'See it on a demo flow first' });
    expect(sample).toHaveAttribute('href', '/sidepanel.html?demo=1');
    expect(sample).toHaveAttribute('target', '_blank');
    expect(screen.getByText('No key needed. Opens in a new tab.')).toBeInTheDocument();
  });

  it('first run end to end: Set up your AI → paste a key → Key accepted → Start chatting returns to the panel', async () => {
    const win = (await fakeBrowser.windows.create({ focused: true }))!;
    await fakeBrowser.tabs.create({ windowId: win.id, url: 'https://example.com/', active: true });
    // The provider's list-models call, the only network the key touches during validation.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      expect(String(input)).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/models/);
      return new Response(JSON.stringify({ data: [{ id: 'claude-sonnet-5', type: 'model' }], has_more: false }), { status: 200 });
    });
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'Set up your AI' }));
    expect(screen.getByRole('link', { name: 'See it on a demo flow first' })).toHaveAttribute('href', '/sidepanel.html?demo=1'); // first-run Settings offers it too
    await userEvent.click(screen.getByRole('button', { name: 'Anthropic · Claude models' }));
    expect(screen.queryByRole('heading', { name: 'Answers' })).not.toBeInTheDocument();

    const field = screen.getByLabelText('Anthropic API key');
    await userEvent.click(field);
    await userEvent.paste('sk-ant-e2e-synthetic-key');
    await screen.findByText('Key accepted');
    // Readiness flipped underneath the open Settings view; it keeps its first-run shape.
    const start = await screen.findByRole('button', { name: 'Start chatting' });
    expect(screen.queryByRole('heading', { name: 'Answers' })).not.toBeInTheDocument();
    await userEvent.click(start);
    await waitFor(() => expect(screen.getByText('Open a Salesforce org to get started, then open any Flow.')).toBeInTheDocument());
    expect(await fakeBrowser.storage.local.get('apiKey:anthropic')).toEqual({ 'apiKey:anthropic': 'sk-ant-e2e-synthetic-key' });
  });

  it('a saved key whose check never completed shows "Check your key" and opens Settings, not "Set up your AI"', async () => {
    const s = defaultSettings();
    await fakeBrowser.storage.local.set({ settings: { ...s, activeProvider: 'anthropic', keys: { ...s.keys, anthropic: { status: 'unchecked', last4: 'wxyz', models: [], checkedAt: 1 } } } });
    await setProviderKey('anthropic', 'test-key-wxyz', 'local');
    const win = (await fakeBrowser.windows.create({ focused: true }))!;
    await fakeBrowser.tabs.create({ windowId: win.id, url: 'https://example.com/', active: true });
    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Check your key'));
    expect(screen.getByText('Your key is saved, but Anthropic couldn’t be reached to check it. Open Settings and check again.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /demo flow/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Settings');
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
  });

  it('with a key the demo still plays recorded answers, no fetch, no count_tokens; its banner points at Flow Builder, and Settings there has no "Try a demo flow"', async () => {
    await readyAnthropic();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('the demo flow must not use the network, key or no key'));
    render(<App demo />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Customer Tier Routing Flow'));
    expect(screen.getByText('v4 · Active')).toBeInTheDocument();
    expect(screen.getByText('This is a demo flow.')).toBeInTheDocument();
    expect(screen.getByText(/^The four actions below play real answers, recorded from .+\.$/)).toBeInTheDocument();
    expect(screen.getByText('Try one of the four')).toBeInTheDocument();
    expect(screen.queryByText('Ready. Ask anything about this flow.')).not.toBeInTheDocument();
    expect(screen.getByText(RECORDED_OUTLINE_HINT)).toBeInTheDocument();
    expect(screen.queryByText(OUTLINE_HINT)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Claude Sonnet 5/ })).not.toBeInTheDocument(); // no model menu, even with a key
    const box = screen.getByLabelText('Message');
    expect(box).toBeDisabled();
    expect(box).toHaveAttribute('placeholder', 'Your API key has been accepted. Open a flow in Flow Builder to ask your own questions.');
    expect(screen.queryByRole('button', { name: 'Set up your AI' })).not.toBeInTheDocument(); // there is a key; the next step is a real flow
    expect(screen.queryByRole('button', { name: 'Quick actions' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^Overview/ }));
    expect(await screen.findByText(RECORDED_OVERVIEW)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()); // the turn finished
    const stored = await fakeBrowser.storage.local.get(null);
    expect(Object.keys(stored).filter((k) => k.startsWith('chat:'))).toEqual(['chat:demo-recorded:300XXXX0000ABCDxyz']); // never the live chat
    expect(fetchSpy).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Answers' });
    expect(screen.queryByRole('link', { name: /demo flow/ })).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('demo mode with no key skips "Set up your AI": the demo flow plays recorded answers, and nothing touches the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('the keyless demo must not use the network'));
    render(<App demo />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Customer Tier Routing Flow'));
    expect(screen.queryByRole('heading', { name: 'Set up your AI' })).not.toBeInTheDocument();
    expect(screen.getByText(/^The four actions below play real answers, recorded from .+\.$/)).toBeInTheDocument();
    expect(screen.getByText('This is a demo flow.')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toHaveAttribute('placeholder', 'Asking questions requires an API key, but you can demo one of the four actions above.');
    expect(screen.getByText('Try one of the four')).toBeInTheDocument();
    expect(screen.queryByText('Ready. Ask anything about this flow.')).not.toBeInTheDocument();
    for (const title of ['Overview', 'Explain an element', 'Document this flow', 'Draw this flow']) expect(screen.getByRole('button', { name: new RegExp(`^${title}`) })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Questions to try' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Outline/ })).toBeInTheDocument(); // the outline stays, with its own hint
    expect(screen.getByText(RECORDED_OUTLINE_HINT)).toBeInTheDocument();
    expect(screen.queryByText(OUTLINE_HINT)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Quick actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'About this flow: Customer Tier Routing Flow' })).not.toBeInTheDocument(); // no gauge in the demo

    await userEvent.click(screen.getByRole('button', { name: /^Overview/ }));
    expect(await screen.findByText(RECORDED_OVERVIEW)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()); // the turn finished
    const stored = await fakeBrowser.storage.local.get(null);
    expect(Object.keys(stored).filter((k) => k.startsWith('chat:'))).toEqual(['chat:demo-recorded:300XXXX0000ABCDxyz']);
    expect(fetchSpy).not.toHaveBeenCalled();

    // The way out: the message box's link opens first-run Settings in this tab.
    await userEvent.click(screen.getByRole('button', { name: 'Set up your AI' }));
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Settings');
    expect(screen.queryByRole('heading', { name: 'Answers' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /demo flow/ })).not.toBeInTheDocument(); // this already is the demo flow
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('demo mode with a saved key whose check never completed plays recorded answers too, and never sends that key', async () => {
    const s = defaultSettings();
    await fakeBrowser.storage.local.set({ settings: { ...s, activeProvider: 'anthropic', keys: { ...s.keys, anthropic: { status: 'unchecked', last4: 'wxyz', models: [], checkedAt: 1 } } } });
    await setProviderKey('anthropic', 'test-key-wxyz', 'local');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('the keyless demo must not use the network'));
    render(<App demo />);
    expect(await screen.findByText('Try one of the four')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Overview/ }));
    expect(await screen.findByText(RECORDED_OVERVIEW)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a key accepted in the demo tab keeps the demo recorded: the same conversation, the banner now pointing at Flow Builder, no setup link, no count_tokens', async () => {
    await fakeBrowser.storage.local.set({ 'chat:demo-recorded:300XXXX0000ABCDxyz': { key: 'chat:demo-recorded:300XXXX0000ABCDxyz', turns: [{ id: 'u', role: 'user', displayText: '', sentText: 'x', mode: 'overview', timestamp: 1 }, { id: 'a', role: 'assistant', displayText: 'A recorded answer.', stopReason: 'end', timestamp: 2 }], updatedAt: 2 } });
    // The provider's list-models call is the only network the key touches, during validation; anything else is a failure.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (!String(input).includes('/v1/models')) throw new Error(`the demo flow must not use the network: ${String(input)}`);
      return new Response(JSON.stringify({ data: [{ id: 'claude-sonnet-5', type: 'model' }], has_more: false }), { status: 200 });
    });
    render(<App demo />);
    expect(await screen.findByText('A recorded answer.')).toBeInTheDocument(); // the recorded conversation, back after a reload
    expect(screen.getByLabelText('Message')).toHaveAttribute('placeholder', 'Asking questions requires an API key, but you can demo one of the four actions above.');
    await userEvent.click(screen.getByRole('button', { name: 'Set up your AI' }));
    await userEvent.click(screen.getByRole('button', { name: 'Anthropic · Claude models' }));
    await userEvent.click(screen.getByLabelText('Anthropic API key'));
    await userEvent.paste('sk-ant-e2e-synthetic-key');
    await userEvent.click(await screen.findByRole('button', { name: 'Start chatting' }));
    expect(await screen.findByText('A recorded answer.')).toBeInTheDocument(); // still the recorded conversation
    expect(screen.getByText('This is a demo flow.')).toBeInTheDocument();
    expect(screen.getByText(/^The four actions below play real answers, recorded from .+\.$/)).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toHaveAttribute('placeholder', 'Your API key has been accepted. Open a flow in Flow Builder to ask your own questions.');
    expect(screen.queryByText(/requires an API key/)).not.toBeInTheDocument();
    expect(screen.queryByText('Ready. Ask anything about this flow.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Set up your AI' })).not.toBeInTheDocument();
    expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([expect.stringMatching(/\/v1\/models/)]); // the key check, and nothing else
  });

  it('with a validated, present key, a non-Salesforce tab shows the "open a Salesforce org" state', async () => {
    await readyAnthropic();
    const win = (await fakeBrowser.windows.create({ focused: true }))!;
    await fakeBrowser.tabs.create({ windowId: win.id, url: 'https://example.com/', active: true });
    render(<App />);
    await waitFor(() => expect(screen.getByText('Open a Salesforce org to get started, then open any Flow.')).toBeInTheDocument());
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Try a demo flow' })).toHaveAttribute('href', '/sidepanel.html?demo=1');
    expect(screen.getByText('Opens in a new tab.')).toBeInTheDocument();
  });
});
