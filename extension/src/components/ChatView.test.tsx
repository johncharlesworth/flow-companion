import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import recordedWith from '../../test/fixtures/synthetic-demo-recorded-with.json';
import type { ActiveFlow } from '@/hooks/useActiveFlow';
import { stopAllRuns } from '@/hooks/useChatStream';
import { chatKey } from '@/lib/chat-history';
import { loadDemoFlow } from '@/lib/demo-flow';
import { setProviderKey } from '@/lib/key-storage';
import { type ProviderId, providerName } from '@/lib/models';
import { defaultSettings, type Settings } from '@/lib/settings';

import { ChatView, type ChatViewProps, OUTLINE_HINT, RECORDED_BANNER, RECORDED_HEADING, RECORDED_OUTLINE_HINT, SAMPLE_FLOW_BANNER_ID, TRY_ANOTHER } from './ChatView';
import type { HeaderFlow } from './Header';
import { DIAGRAM_FOOTER, DRAW_CHIP } from './Transcript';
import { TooltipProvider } from './ui/tooltip';

const ANSWERS = {
  overview: 'This flow routes accounts by tier and then creates a follow-up task.',
  document: '# The flow\n\nA document of the demo flow.',
  draw: '```mermaid\nflowchart TD\n  A["Account is updated"] --> B{"Enterprise account?"}\n  B -->|Yes| C["Update the account"]\n```\n\nOne decision.',
  explain: { CheckCustomerType: 'It sorts accounts by their type.' } as Record<string, string>,
};

// The real adapter, with answers of the test's own and no waiting: the bundled
// answers change whenever they are re-recorded, and their pace is for people.
// A test that needs an answer to stay in flight sets a long first pause.
const INSTANT = { firstMs: 0, everyMs: 0, chars: 14 };
const pace = vi.hoisted(() => ({ current: { firstMs: 0, everyMs: 0, chars: 14 } }));
vi.mock('@/lib/providers/recorded', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/providers/recorded')>();
  return {
    ...real,
    recordedProvider: (lookup: Parameters<typeof real.recordedProvider>[0]) => real.recordedProvider(lookup, pace.current, async () => ANSWERS),
  };
});
// The two on-demand modules need a real browser; here they are scripted.
vi.mock('@/lib/mermaid-render.lazy', () => ({ renderDiagram: async () => '<svg data-test="drawn"><g class="node"></g></svg>' }));
vi.mock('@/lib/excalidraw-export.lazy', () => ({ toExcalidrawClipboard: async () => JSON.stringify({ type: 'excalidraw-api/clipboard', elements: [] }) }));

const header: HeaderFlow = { label: 'Customer Tier Routing Flow', version: 4, status: 'Active', latestNumber: 4, activeNumber: 4, lastModified: '2026-09-01T10:00:00.000Z' };
const LABEL = recordedWith.modelLabel;

let flow: ActiveFlow;
let fetchSpy: ReturnType<typeof vi.spyOn>;

function renderChat(over: Partial<ChatViewProps> = {}) {
  const props: ChatViewProps = {
    flow,
    header,
    refreshing: false,
    onRefresh: vi.fn(),
    settings: defaultSettings(),
    onUpdateSettings: vi.fn(async () => undefined),
    onOpenSettings: vi.fn(),
    now: Date.parse('2026-09-01T10:05:00.000Z'),
    ...over,
  };
  render(
    <TooltipProvider>
      <ChatView {...props} />
    </TooltipProvider>,
  );
  return props;
}

beforeEach(async () => {
  flow = await loadDemoFlow();
});
afterEach(() => {
  stopAllRuns();
  pace.current = INSTANT;
});

describe('ChatView · the demo flow with no key', () => {
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('the keyless demo must not use the network'));
  });

  it('shows the banner, "Try one of the four", the four cards, and the outline; no questions to try, no model menu', async () => {
    renderChat({ recorded: true });
    const banner = screen.getByText(RECORDED_BANNER.rest(LABEL));
    expect(banner).toHaveAttribute('role', 'status');
    expect(banner).toHaveTextContent(`This is a demo flow. The four actions below play real answers, recorded from ${LABEL}.`);
    expect(banner).not.toHaveTextContent(/API key|Flow Builder/);
    expect(within(banner).getByText('This is a demo flow.')).toHaveClass('font-semibold');

    expect(screen.getByText(RECORDED_HEADING)).toBeInTheDocument();
    expect(RECORDED_HEADING).toBe('Try one of the four');
    expect(screen.queryByText('Ready. Ask anything about this flow.')).not.toBeInTheDocument();
    for (const title of ['Overview', 'Explain an element', 'Document this flow', 'Draw this flow']) expect(screen.getByRole('button', { name: new RegExp(`^${title}`) })).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'Questions to try' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Outline/ })).toBeInTheDocument();
    expect(screen.getByText(RECORDED_OUTLINE_HINT)).toBeInTheDocument();
    expect(screen.queryByText(OUTLINE_HINT)).not.toBeInTheDocument();

    expect(screen.queryByRole('button', { name: new RegExp(LABEL) })).not.toBeInTheDocument(); // no model menu
    expect(screen.queryByText(new RegExp(`Recorded from ${LABEL}`))).not.toBeInTheDocument(); // the banner names the model once
    expect(screen.queryByRole('button', { name: 'Quick actions' })).not.toBeInTheDocument(); // the cards, then the chip row
    expect(screen.queryByRole('button', { name: /^About this flow/ })).not.toBeInTheDocument(); // no gauge: nothing is sent, so there is nothing to count
    expect(screen.getByLabelText('Message')).toBeDisabled();
    expect(screen.getByLabelText('Message')).toHaveAttribute('aria-describedby', SAMPLE_FLOW_BANNER_ID);
    expect(banner).toHaveAttribute('id', SAMPLE_FLOW_BANNER_ID);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('"Set up your AI" sits in the message box next to Send, the only two controls on that row, with no status row, and opens Settings', async () => {
    const props = renderChat({ recorded: true });
    const link = screen.getByRole('button', { name: 'Set up your AI' });
    expect(link.nextElementSibling).toBe(screen.getByRole('button', { name: 'Send' }));
    expect(link.parentElement!.querySelectorAll('button')).toHaveLength(2);
    expect(document.querySelector('svg.lucide-gauge')).toBeNull();
    expect(screen.queryByText('Your own questions need an API key.')).not.toBeInTheDocument();
    await userEvent.click(link);
    expect(props.onOpenSettings).toHaveBeenCalledOnce();
  });

  it('Overview plays its recorded answer to the end, and the banner stays above the conversation', async () => {
    renderChat({ recorded: true });
    await userEvent.click(screen.getByRole('button', { name: /^Overview/ }));
    expect(await screen.findByText(ANSWERS.overview)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()); // Stop has gone: the turn finished
    expect(screen.getByText(RECORDED_BANNER.rest(LABEL))).toBeInTheDocument();

    // A second answer is the first that could claim the flow was re-read; nothing was sent, so it must not.
    await userEvent.click(within(screen.getByRole('group', { name: TRY_ANOTHER.group })).getByRole('button', { name: 'Document this flow' }));
    expect(await screen.findByText('A document of the demo flow.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument());
    expect(screen.queryByText(/re-read the whole flow/)).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('picking an element in the Explain picker plays its answer at once, with no chip left on the message box', async () => {
    renderChat({ recorded: true });
    await userEvent.click(screen.getByRole('button', { name: /^Explain an element/ }));
    await userEvent.type(screen.getByLabelText('Search elements'), 'Check');
    await userEvent.click(screen.getByRole('option', { name: /CheckCustomerType/ }));
    expect(await screen.findByText(ANSWERS.explain.CheckCustomerType!)).toBeInTheDocument();
    expect(screen.getByText('Explain')).toBeInTheDocument(); // the pill
    expect(screen.queryByRole('button', { name: 'Remove CheckCustomerType' })).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('the outline under the cards lists the demo flow’s elements with its own hint, and picking one plays its explanation at once', async () => {
    renderChat({ recorded: true });
    expect(RECORDED_OUTLINE_HINT).toBe('Pick one to see it explained.');
    expect(screen.getByText(RECORDED_OUTLINE_HINT)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Outline/ }));
    expect(screen.queryByText(RECORDED_OUTLINE_HINT)).not.toBeInTheDocument();
    expect(screen.getByRole('listbox', { name: 'Flow elements' })).toBeInTheDocument();
    // The same groups as the live outline, collapsed until opened.
    await userEvent.click(screen.getByRole('button', { name: /^Decisions/ }));
    expect(screen.getByRole('option', { name: /Check Customer Type/ })).toHaveTextContent('CheckCustomerType');
    await userEvent.click(screen.getByRole('button', { name: /^Create Records/ }));
    expect(screen.getByRole('option', { name: /Create Followup Task/ })).toHaveTextContent('CreateFollowupTask');

    await userEvent.click(screen.getByRole('option', { name: /CheckCustomerType/ }));
    expect(await screen.findByText(ANSWERS.explain.CheckCustomerType!)).toBeInTheDocument();
    expect(screen.getByText('Explain')).toBeInTheDocument(); // the pill
    expect(screen.getByText('CheckCustomerType')).toBeInTheDocument(); // the turn's focus element, beside it
    expect(screen.queryByRole('button', { name: 'Remove CheckCustomerType' })).not.toBeInTheDocument(); // nothing attached to the message box
    expect(screen.queryByRole('listbox', { name: 'Flow elements' })).not.toBeInTheDocument(); // the conversation took the outline's place
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Draw this flow renders the diagram with a footer naming who drew it, keeps Open in Excalidraw and the Mermaid link, and offers no further drawings', async () => {
    renderChat({ recorded: true });
    await userEvent.click(screen.getByRole('button', { name: /^Draw this flow/ }));
    await waitFor(() => expect(screen.getByText(DIAGRAM_FOOTER(providerName(recordedWith.provider as ProviderId), 'business'))).toBeInTheDocument());
    expect(document.querySelector('svg[data-test="drawn"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Open in Excalidraw' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'copy the Mermaid text' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: DRAW_CHIP.admins })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: DRAW_CHIP.fromElement })).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('names the provider and model of the recording, whatever the settings say', async () => {
    // A provider that is not the recording's, as a saved but unusable key leaves behind.
    const other = (['anthropic', 'openai', 'google'] as const).find((p) => p !== recordedWith.provider)!;
    renderChat({ recorded: true, settings: { ...defaultSettings(), activeProvider: other } });
    expect(screen.getByText(RECORDED_BANNER.rest(LABEL))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Draw this flow/ }));
    await waitFor(() => expect(screen.getByText(DIAGRAM_FOOTER(providerName(recordedWith.provider as ProviderId), 'business'))).toBeInTheDocument());
    expect(screen.queryByText(DIAGRAM_FOOTER(providerName(other), 'business'))).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a Document answer keeps Copy and Download', async () => {
    renderChat({ recorded: true });
    await userEvent.click(screen.getByRole('button', { name: /^Document this flow/ }));
    expect(await screen.findByRole('button', { name: 'Download' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  describe('the "Try another" row', () => {
    const CHIPS = ['Overview', 'Explain an element', 'Document this flow', 'Draw this flow'];
    const row = () => screen.getByRole('group', { name: TRY_ANOTHER.group });

    it('is absent before the first answer', () => {
      renderChat({ recorded: true });
      expect(screen.queryByRole('group', { name: TRY_ANOTHER.group })).not.toBeInTheDocument();
      expect(screen.queryByText(TRY_ANOTHER.label)).not.toBeInTheDocument();
    });

    it('after an answer, shows the four actions as chips over the message box, and Document plays a document turn', async () => {
      renderChat({ recorded: true });
      await userEvent.click(screen.getByRole('button', { name: /^Overview/ }));
      expect(await screen.findByText(ANSWERS.overview)).toBeInTheDocument();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument());

      expect(TRY_ANOTHER.label).toBe('Try another:');
      expect(within(row()).getByText(TRY_ANOTHER.label)).toHaveClass('text-xs', 'text-text-3');
      expect(within(row()).getAllByRole('button').map((b) => b.textContent)).toEqual(CHIPS);
      for (const chip of within(row()).getAllByRole('button')) expect(chip).toBeEnabled();

      await userEvent.click(within(row()).getByRole('button', { name: 'Document this flow' }));
      expect(await screen.findByText('A document of the demo flow.')).toBeInTheDocument();
      expect(screen.getByText('Document')).toBeInTheDocument(); // the question's pill
      await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument());
      expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('Explain an element opens the picker, and the row waits behind it', async () => {
      renderChat({ recorded: true });
      await userEvent.click(screen.getByRole('button', { name: /^Overview/ }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument());
      await userEvent.click(within(row()).getByRole('button', { name: 'Explain an element' }));
      expect(screen.getByLabelText('Search elements')).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: TRY_ANOTHER.group })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Back' }));
      expect(row()).toBeInTheDocument();
    });

    it('is disabled while an answer plays', async () => {
      pace.current = { firstMs: 60_000, everyMs: 0, chars: 14 };
      renderChat({ recorded: true });
      await userEvent.click(screen.getByRole('button', { name: /^Overview/ }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument());
      for (const chip of within(row()).getAllByRole('button')) expect(chip).toBeDisabled();
      expect(within(row()).getAllByRole('button')).toHaveLength(4);
    });
  });
});

describe('ChatView · the demo flow with a key', () => {
  const READY = (() => {
    const s = defaultSettings();
    return { ...s, activeProvider: 'anthropic' as const, keys: { ...s.keys, anthropic: { status: 'validated' as const, last4: 'wxyz', models: [{ id: 'claude-sonnet-5' }], checkedAt: 1 } } };
  })();

  beforeEach(async () => {
    await fakeBrowser.storage.local.set({ settings: READY });
    await setProviderKey('anthropic', 'test-key-wxyz', 'local');
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('the demo flow must not use the network, key or no key'));
  });

  it('still plays the recording: the banner is the same two sentences, the box points at Flow Builder, and there is no setup link, model menu, plus, or gauge', async () => {
    renderChat({ recorded: true, keyReady: true, settings: READY });
    const banner = screen.getByText(RECORDED_BANNER.rest(LABEL));
    expect(banner).toHaveTextContent(`This is a demo flow. The four actions below play real answers, recorded from ${LABEL}.`);
    expect(banner).not.toHaveTextContent(/API key|Flow Builder/);
    expect(screen.queryByText(/requires an API key/)).not.toBeInTheDocument();
    expect(screen.getByText(RECORDED_HEADING)).toBeInTheDocument();
    expect(screen.queryByText('Ready. Ask anything about this flow.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Questions to try' })).not.toBeInTheDocument();
    expect(screen.getByText(RECORDED_OUTLINE_HINT)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Claude Sonnet 5/ })).not.toBeInTheDocument(); // no model menu, even though the key has one
    expect(screen.queryByRole('button', { name: 'Quick actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set up your AI' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^About this flow/ })).not.toBeInTheDocument(); // no gauge
    expect(screen.getByRole('button', { name: 'Send' }).parentElement!.querySelectorAll('button')).toHaveLength(1); // Send alone on the bottom row
    const box = screen.getByLabelText('Message');
    expect(box).toBeDisabled();
    expect(box).toHaveAttribute('placeholder', 'Your API key has been accepted. Open a flow in Flow Builder to ask your own questions.');
    expect(box).toHaveAttribute('aria-describedby', SAMPLE_FLOW_BANNER_ID);

    await userEvent.click(screen.getByRole('button', { name: /^Overview/ }));
    expect(await screen.findByText(ANSWERS.overview)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument());
    expect(screen.getByText(RECORDED_BANNER.rest(LABEL))).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled(); // no request, and no count_tokens measure
  });
});

describe('ChatView · a real flow with a key', () => {
  it('is the everyday chat: no banner, the usual heading, questions to try, the outline, the model menu, and the gauge', async () => {
    const s = defaultSettings();
    const settings: Settings = { ...s, activeProvider: 'anthropic', keys: { ...s.keys, anthropic: { status: 'validated', last4: 'wxyz', models: [{ id: 'claude-sonnet-5' }], checkedAt: 1 } } };
    await fakeBrowser.storage.local.set({ settings });
    await setProviderKey('anthropic', 'test-key-wxyz', 'local');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ input_tokens: 1_200 }), { status: 200 }));
    renderChat({ settings });
    expect(screen.getByText('Ready. Ask anything about this flow.')).toBeInTheDocument();
    expect(screen.queryByText(RECORDED_HEADING)).not.toBeInTheDocument();
    expect(screen.queryByText(/This is a demo flow/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Questions to try' })).toBeInTheDocument();
    expect(screen.getByText(OUTLINE_HINT)).toBeInTheDocument();
    expect(screen.queryByText(RECORDED_OUTLINE_HINT)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Claude Sonnet 5/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeEnabled();
    expect(screen.getByLabelText('Message')).not.toHaveAttribute('aria-describedby');
    expect(screen.getByRole('button', { name: 'Quick actions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About this flow: Customer Tier Routing Flow' })).toBeInTheDocument(); // the gauge, live only
    expect(screen.queryByRole('button', { name: 'Set up your AI' })).not.toBeInTheDocument();
  });

  it('shows no "Try another" row over the message box, even with answers in the chat', async () => {
    const s = defaultSettings();
    const settings: Settings = { ...s, activeProvider: 'anthropic', keys: { ...s.keys, anthropic: { status: 'validated', last4: 'wxyz', models: [{ id: 'claude-sonnet-5' }], checkedAt: 1 } } };
    const key = chatKey(flow.orgId, flow.loaded.record.DefinitionId);
    await fakeBrowser.storage.local.set({
      settings,
      [key]: { key, updatedAt: 1, turns: [
        { role: 'user', displayText: 'Overview', mode: 'overview', timestamp: 1 },
        { role: 'assistant', displayText: 'An answer from earlier.', stopReason: 'end', timestamp: 2 },
      ] },
    });
    await setProviderKey('anthropic', 'test-key-wxyz', 'local');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ input_tokens: 1_200 }), { status: 200 }));
    renderChat({ settings });
    expect(await screen.findByText('An answer from earlier.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: TRY_ANOTHER.group })).not.toBeInTheDocument();
    expect(screen.queryByText(TRY_ANOTHER.label)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quick actions' })).toBeInTheDocument();
  });
});
