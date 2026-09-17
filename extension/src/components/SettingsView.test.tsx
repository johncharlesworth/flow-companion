import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { getProviderKey, setProviderKey } from '@/lib/key-storage';
import { defaultSettings, readSettings } from '@/lib/settings';
import type { validateKey } from '@/lib/validate-key';

import { SettingsView } from './SettingsView';
import { TooltipProvider } from './ui/tooltip';

const accepted: typeof validateKey = async () => ({ outcome: 'accepted', models: [{ id: 'claude-sonnet-5', maxInputTokens: 1_000_000 }, { id: 'claude-opus-5' }] });
const rejected: typeof validateKey = async () => ({ outcome: 'rejected' });

function renderSettings(props: Partial<Parameters<typeof SettingsView>[0]> = {}) {
  return render(
    <TooltipProvider>
      <SettingsView onBack={vi.fn()} {...props} />
    </TooltipProvider>,
  );
}

async function paste(input: HTMLElement, text: string) {
  input.focus();
  await userEvent.paste(text);
}

describe('SettingsView — AI provider', () => {
  it('first run: only the provider section; choosing a card expands it; an accepted key stores it and offers Start chatting', async () => {
    const onStart = vi.fn();
    renderSettings({ firstRun: true, onStartChatting: onStart, validate: accepted });
    expect(await screen.findByText('Anthropic · Claude models')).toBeInTheDocument();
    expect(screen.queryByText('Answers')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start chatting' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('Anthropic · Claude models'));
    const field = await screen.findByLabelText('Anthropic API key');
    await paste(field, 'sk-ant-api03-synthetic');
    expect(await screen.findByText('Key accepted')).toBeInTheDocument();

    await waitFor(async () => expect(await getProviderKey('anthropic', 'local')).toBe('sk-ant-api03-synthetic'));
    const settings = await readSettings();
    expect(settings.activeProvider).toBe('anthropic');
    expect(settings.keys.anthropic).toMatchObject({ status: 'validated', last4: 'etic', models: [{ id: 'claude-sonnet-5', maxInputTokens: 1_000_000 }, { id: 'claude-opus-5' }] });
    expect(JSON.stringify(await fakeBrowser.storage.local.get('settings'))).not.toContain('sk-ant');

    await userEvent.click(await screen.findByRole('button', { name: 'Start chatting' }));
    expect(onStart).toHaveBeenCalled();
  });

  it('opening a card only expands it; a provider becomes active when its key is accepted, or when its accepted key is chosen', async () => {
    const s = defaultSettings();
    await fakeBrowser.storage.local.set({ settings: { ...s, activeProvider: 'anthropic', keys: { ...s.keys, anthropic: { status: 'validated', last4: 'wxyz', models: [{ id: 'claude-sonnet-5' }], checkedAt: 1 } } } });
    await setProviderKey('anthropic', 'test-key-wxyz', 'local');
    renderSettings({ validate: accepted });

    // Curiosity click on a provider with no key: expands, does not switch.
    await userEvent.click(await screen.findByText('Google · Gemini models'));
    expect(await screen.findByLabelText('Google API key')).toBeInTheDocument();
    expect((await readSettings()).activeProvider).toBe('anthropic');

    // Accepting a key for that provider makes it active.
    await paste(screen.getByLabelText('Google API key'), 'AIza-synthetic-google-key');
    expect(await screen.findByText('Key accepted')).toBeInTheDocument();
    await waitFor(async () => expect((await readSettings()).activeProvider).toBe('google'));

    // Choosing the other accepted provider switches back.
    await userEvent.click(screen.getByText('Anthropic · Claude models'));
    await waitFor(async () => expect((await readSettings()).activeProvider).toBe('anthropic'));
  });

  it('a rejected key is not stored and says so; the key is never rendered', async () => {
    renderSettings({ validate: rejected });
    await userEvent.click(await screen.findByText('OpenAI · GPT models'));
    const field = await screen.findByLabelText('OpenAI API key');
    await paste(field, 'sk-proj-synthetic-bad');
    expect(await screen.findByText('Key rejected — check it was copied fully')).toBeInTheDocument();
    expect(await getProviderKey('openai', 'local')).toBeNull();
    expect((await readSettings()).keys.openai.status).toBe('rejected');
    expect(field).toHaveAttribute('type', 'password');
    expect(document.body.textContent).not.toContain('sk-proj-synthetic-bad');
  });

  it('an unreachable provider keeps the key, says to check again, and Check again validates the saved key without re-pasting', async () => {
    let calls = 0;
    const flaky: typeof validateKey = async () => (calls++ === 0 ? { outcome: 'unreachable' } : { outcome: 'accepted', models: [{ id: 'gemini-3.5-flash' }] });
    renderSettings({ validate: flaky });
    await userEvent.click(await screen.findByText('Google · Gemini models'));
    await paste(await screen.findByLabelText('Google API key'), 'AIza-synthetic-google-key');
    expect(await screen.findByText('Couldn’t reach Google — key saved. Check again when you’re online')).toBeInTheDocument();
    expect(await getProviderKey('google', 'local')).toBe('AIza-synthetic-google-key');
    expect((await readSettings()).keys.google.status).toBe('unchecked');

    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('Key accepted')).toBeInTheDocument();
    expect((await readSettings()).keys.google.status).toBe('validated');
    expect(calls).toBe(2);
  });

  it('a saved key that was never checked offers Check again on its own, from the saved key', async () => {
    const s = defaultSettings();
    await fakeBrowser.storage.local.set({ settings: { ...s, activeProvider: 'anthropic', keys: { ...s.keys, anthropic: { status: 'unchecked', last4: 'wxyz', models: [], checkedAt: 1 } } } });
    await setProviderKey('anthropic', 'sk-ant-synthetic-wxyz', 'local');
    let checked = '';
    const validate: typeof validateKey = async (_provider, key) => {
      checked = key;
      return { outcome: 'accepted', models: [{ id: 'claude-sonnet-5' }] };
    };
    renderSettings({ validate });
    expect(await screen.findByText('Key ending in wxyz saved, not checked yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('Key accepted')).toBeInTheDocument();
    expect(checked).toBe('sk-ant-synthetic-wxyz');
  });

  it('a key that belongs to another provider shows the hint with a one-click switch', async () => {
    renderSettings({ validate: rejected }); // OpenAI would reject an Anthropic-shaped key on blur
    await userEvent.click(await screen.findByText('OpenAI · GPT models'));
    const field = await screen.findByLabelText('OpenAI API key');
    await userEvent.type(field, 'sk-ant-api03-synthetic');
    expect(screen.getByText(/This looks like an Anthropic key, but OpenAI is selected/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Anthropic' }));
    expect(await screen.findByLabelText('Anthropic API key')).toBeInTheDocument();
    expect((await readSettings()).activeProvider).toBeNull(); // nothing is active until a key is accepted
  });

  it('turning "remember" off moves the keys to session storage without changing readiness', async () => {
    const s = defaultSettings();
    await fakeBrowser.storage.local.set({ settings: { ...s, activeProvider: 'anthropic', keys: { ...s.keys, anthropic: { status: 'validated', last4: 'wxyz', models: [], checkedAt: 1 } } } });
    await setProviderKey('anthropic', 'test-key-wxyz', 'local');
    renderSettings();
    const box = await screen.findByRole('checkbox', { name: /Remember this key/ });
    expect(box).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(box);
    await waitFor(async () => expect(await getProviderKey('anthropic', 'session')).toBe('test-key-wxyz'));
    expect(await getProviderKey('anthropic', 'local')).toBeNull();
    const after = await readSettings();
    expect(after.rememberOnDevice).toBe(false);
    expect(after.keys.anthropic.status).toBe('validated');
  });

  it('shows the Google free-tier line only on the Google card, and every card carries the provider-named disclosure', async () => {
    renderSettings();
    await userEvent.click(await screen.findByText('Anthropic · Claude models'));
    expect(screen.getByText(/is sent to Anthropic under your key/)).toBeInTheDocument();
    expect(screen.queryByText(/free tier/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Google · Gemini models'));
    expect(await screen.findByText(/On Google’s free tier/)).toBeInTheDocument();
  });
});

describe('SettingsView — Answers, Appearance, Forget', () => {
  it('saves custom instructions on blur, capped, and the Detail choice', async () => {
    renderSettings();
    const box = await screen.findByLabelText('How should the assistant respond?');
    await userEvent.type(box, 'Answer in Portuguese.');
    await userEvent.tab();
    await waitFor(async () => expect((await readSettings()).customInstructions).toBe('Answer in Portuguese.'));
    expect(box).toHaveAttribute('maxlength', '1500');
    await userEvent.click(screen.getByRole('radio', { name: 'Thorough' }));
    await waitFor(async () => expect((await readSettings()).detail).toBe('thorough'));
    expect(screen.getByText(/Thorough answers take longer/)).toBeInTheDocument();
  });

  it('offers "Try the demo" as a link to the panel in demo mode, in a new tab', async () => {
    renderSettings();
    const link = await screen.findByRole('link', { name: /Try the demo/ });
    expect(link).toHaveAttribute('href', '/sidepanel.html?demo=1');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('Forget everything asks first, then clears keys, settings, and chats', async () => {
    const s = defaultSettings();
    await fakeBrowser.storage.local.set({ settings: { ...s, activeProvider: 'anthropic', customInstructions: 'x' }, 'chat:00D:300': { turns: [] } });
    await setProviderKey('anthropic', 'test-key-wxyz', 'local');
    const onBack = vi.fn();
    renderSettings({ onBack });
    await userEvent.click(await screen.findByRole('button', { name: 'Forget everything on this computer' }));
    expect(screen.getByText(/removes your keys, settings, and every chat/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Forget everything' }));
    await waitFor(async () => expect(await fakeBrowser.storage.local.get(null)).toEqual({}));
    expect(await getProviderKey('anthropic', 'local')).toBeNull();
    expect(onBack).toHaveBeenCalledOnce(); // back to the panel, which now shows "Set up your AI"
  });
});
