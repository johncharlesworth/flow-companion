import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';


import { Composer, type ComposerProps } from './Composer';
import { TooltipProvider } from './ui/tooltip';

function renderComposer(over: Partial<ComposerProps> = {}) {
  const props: ComposerProps = {
    flowLabel: 'Customer Tier Routing Flow',
    chipStory: 'Your first question sends the whole flow to Anthropic.',
    chipSummary: null,
    chipRows: [['Sent', '0 tokens']],
    modelChip: <span>Claude Sonnet 5</span>,
    busy: false,
    onSend: vi.fn(),
    onStop: vi.fn(),
    onQuickAction: vi.fn(),
    onDrawFromElement: vi.fn(),
    onDrawEvery: vi.fn(),
    blocked: null,
    nudge: false,
    onNewChat: vi.fn(),
    onDismissNudge: vi.fn(),
    ...over,
  };
  render(
    <TooltipProvider>
      <Composer {...props} />
    </TooltipProvider>,
  );
  return props;
}


describe('Composer', () => {
  it('sends what was typed on Enter, and the Actions chip opens the menu: the four actions with the three pictures together, and no starter questions', async () => {
    const props = renderComposer();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Message'), 'Why does it branch?{Enter}');
    expect(props.onSend).toHaveBeenCalledWith('Why does it branch?');

    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    // The three pictures sit together; a reorder of the menu must not strand one
    // of them.
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Overview',
      'Draw main paths',
      'Draw one element',
      'Draw every element',
      'Document this flow',
      'Explain an element',
    ]);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Draw every element' }));
    expect(props.onDrawEvery).toHaveBeenCalledOnce();
  });

  it('puts Actions, the model chip, the gauge, and Send in that order on the bottom row, each a named control', () => {
    renderComposer();
    const gauge = screen.getByRole('button', { name: 'About this flow: Customer Tier Routing Flow' });
    const actions = screen.getByRole('button', { name: 'Actions' });
    const send = screen.getByRole('button', { name: 'Send' });
    // Left to right: Actions, the model chip, the gauge, Send. Actions carries
    // mr-auto, so the slack sits between it and the model chip.
    const chipSlot = screen.getByText('Claude Sonnet 5').closest('span.min-w-0');
    expect(actions.nextElementSibling).toBe(chipSlot);
    expect(chipSlot?.nextElementSibling).toBe(gauge);
    expect(gauge.nextElementSibling).toBe(send);
    expect(actions).toHaveClass('mr-auto');
    expect(chipSlot?.parentElement).toBe(gauge.parentElement); // one row
    expect(gauge.parentElement).toHaveClass('gap-2'); // the same gap between the chip and the buttons as between the buttons
    expect(gauge.parentElement).not.toHaveClass('gap-1');
    // All of them are one height so the row stays level; Actions carries a word,
    // so it is the one that is not square.
    for (const button of [gauge, actions, send]) expect(button).toHaveClass('h-8');
    for (const button of [gauge, send]) expect(button).toHaveClass('w-8');
    expect(actions).not.toHaveClass('w-8'); // labelled, so not a square
    // Actions is a rounded rectangle outlined in the box's own border; the model
    // chip is the same shape rather than an oval.
    expect(actions).toHaveClass('rounded-button', 'border', 'border-composer-line');
    expect(gauge).toHaveAttribute('type', 'button');
    expect(actions).toHaveAttribute('type', 'button');
  });

  it('shows no keyboard hint, on first focus or ever', async () => {
    renderComposer();
    const box = screen.getByLabelText('Message');
    box.focus();
    await userEvent.type(box, 'a');
    expect(screen.queryByText(/Enter to send/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Shift\+Enter/)).not.toBeInTheDocument();
  });

  it('carries no flow chip and no element chip: the flow is named only by the gauge, and the box starts with the message', () => {
    renderComposer();
    expect(screen.queryByText('Customer Tier Routing Flow')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Message').previousElementSibling).toBeNull();
  });

  it('turns Actions off while an answer streams: every row in it would start another answer, which would be dropped', () => {
    renderComposer({ busy: true });
    expect(screen.getByRole('button', { name: 'Actions' })).toBeDisabled();
    expect(screen.getByText('Claude Sonnet 5')).toBeInTheDocument(); // the model chip
    expect(screen.queryByRole('button', { name: 'Set up your AI' })).not.toBeInTheDocument();
  });

  it('the gauge pins the flow card, headed "No questions yet" before an answer, with the rows and the story', async () => {
    renderComposer();
    await userEvent.click(screen.getByRole('button', { name: 'About this flow: Customer Tier Routing Flow' }));
    expect(await screen.findByText('No questions yet')).toBeInTheDocument();
    expect(screen.getByRole('term')).toHaveTextContent('Sent');
    expect(screen.getByRole('definition')).toHaveTextContent('0 tokens');
    expect(screen.getByText('Your first question sends the whole flow to Anthropic.')).toBeInTheDocument();
  });
});

describe('Composer · the demo flow with no key', () => {
  const RECORDED = { keyReady: false, onSetUp: vi.fn(), describedBy: 'sample-flow-banner' };

  it('turns the message box and Send off, points the box at the banner that says why, and "Set up your AI" asks for setup', async () => {
    const onSetUp = vi.fn();
    const props = renderComposer({ recorded: { ...RECORDED, onSetUp } });
    expect(screen.getByLabelText('Message')).toHaveAttribute('placeholder', 'Asking questions requires an API key, but you can demo one of the four actions above.');
    const box = screen.getByLabelText('Message');
    expect(box).toBeDisabled();
    expect(box).toHaveAttribute('aria-describedby', 'sample-flow-banner');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await userEvent.type(box, 'Why does it branch?{Enter}');
    expect(props.onSend).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Set up your AI' }));
    expect(onSetUp).toHaveBeenCalledOnce();
  });

  it('carries no status row, no Actions, and no gauge: the link and Send are the only controls on the bottom row, the link immediately left of Send', () => {
    renderComposer({ recorded: RECORDED, chipRows: [] });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText('Your own questions need an API key.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^About this flow/ })).not.toBeInTheDocument(); // nothing is sent, so there is nothing to count
    expect(document.querySelector('svg.lucide-gauge')).toBeNull();
    const link = screen.getByRole('button', { name: 'Set up your AI' });
    const send = screen.getByRole('button', { name: 'Send' });
    expect(link.parentElement).toBe(send.parentElement); // the same bottom row
    expect(link.nextElementSibling).toBe(send); // immediately to its left
    expect(link.parentElement!.querySelectorAll('button')).toHaveLength(2);
    expect(link).toHaveClass('text-accent');
  });

  it('keeps Stop while an answer plays', async () => {
    const props = renderComposer({ recorded: RECORDED, busy: true });
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Set up your AI' }).nextElementSibling).toBe(screen.getByRole('button', { name: 'Stop' }));
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(props.onStop).toHaveBeenCalledOnce();
  });
});

describe('Composer \u00b7 the demo flow with a key', () => {
  const RECORDED = { keyReady: true, onSetUp: vi.fn(), describedBy: 'sample-flow-banner' };

  it('keeps the box and Send off, points at Flow Builder instead of a key, and drops the setup link: Send is the only control on the bottom row', async () => {
    const props = renderComposer({ recorded: RECORDED });
    const box = screen.getByLabelText('Message');
    expect(box).toHaveAttribute('placeholder', 'Your API key has been accepted. Open a flow in Flow Builder to ask your own questions.');
    expect(box).toBeDisabled();
    expect(box).toHaveAttribute('aria-describedby', 'sample-flow-banner');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await userEvent.type(box, 'Why does it branch?{Enter}');
    expect(props.onSend).not.toHaveBeenCalled();

    expect(screen.queryByRole('button', { name: 'Set up your AI' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^About this flow/ })).not.toBeInTheDocument(); // no gauge in the demo
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send.parentElement!.querySelectorAll('button')).toHaveLength(1);
  });

  it('keeps Stop while an answer plays', () => {
    renderComposer({ recorded: RECORDED, busy: true });
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Set up your AI' })).not.toBeInTheDocument();
  });
});
