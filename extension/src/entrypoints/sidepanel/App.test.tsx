import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { setProviderKey } from '@/lib/key-storage';
import { defaultSettings } from '@/lib/settings';

import { OUTLINE_HINT } from '@/components/ChatView';

import { App } from './App';

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
    await userEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Settings');
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
  });

  it('demo mode shows the bundled sample flow with no Salesforce tab at all, and Settings there has no "Try the demo"', async () => {
    await readyAnthropic();
    // The flow measure (count_tokens) is the only network the demo touches; answer it locally.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ input_tokens: 1_200 }), { status: 200 }));
    render(<App demo />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Customer Tier Routing Flow'));
    expect(screen.getByText('v4 · Active')).toBeInTheDocument();
    expect(screen.getByText('Ready. Ask anything about this flow.')).toBeInTheDocument();
    expect(screen.getByText('Tip: drag the panel’s left edge to make it wider.')).toBeInTheDocument(); // narrow panels only (CSS), until the first message
    expect(screen.getByText(OUTLINE_HINT)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Outline/ }));
    expect(screen.queryByText(OUTLINE_HINT)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Search elements')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Outline/ }));
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Answers' });
    expect(screen.queryByRole('link', { name: /Try the demo/ })).not.toBeInTheDocument();
  });

  it('with a validated, present key, a non-Salesforce tab shows the "open a Salesforce org" state', async () => {
    await readyAnthropic();
    const win = (await fakeBrowser.windows.create({ focused: true }))!;
    await fakeBrowser.tabs.create({ windowId: win.id, url: 'https://example.com/', active: true });
    render(<App />);
    await waitFor(() => expect(screen.getByText('Open a Salesforce org to get started, then open any Flow.')).toBeInTheDocument());
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
