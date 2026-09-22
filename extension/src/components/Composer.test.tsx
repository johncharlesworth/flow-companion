import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { STARTER_QUESTIONS } from '@/lib/modes';

import { Composer, type ComposerProps } from './Composer';
import { TooltipProvider } from './ui/tooltip';

function renderComposer(over: Partial<ComposerProps> = {}) {
  const props: ComposerProps = {
    flowLabel: 'Customer Tier Routing Flow',
    chipStory: 'Your first question sends the whole flow to Anthropic.',
    chipSummary: null,
    chipRows: [['Sent', '0 tokens']],
    element: null,
    onRemoveElement: vi.fn(),
    modelChip: <span>Claude Sonnet 5</span>,
    busy: false,
    onSend: vi.fn(),
    onStop: vi.fn(),
    onQuickAction: vi.fn(),
    onDrawFromElement: vi.fn(),
    onStarter: vi.fn(),
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

const FOUR = ['Overview', 'Explain an element', 'Document this flow', 'Draw this flow'];

describe('Composer', () => {
  it('sends what was typed on Enter, and the plus button opens the quick-actions menu: the four actions, Draw one element, and the starter questions', async () => {
    const props = renderComposer();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Message'), 'Why does it branch?{Enter}');
    expect(props.onSend).toHaveBeenCalledWith('Why does it branch?');

    await userEvent.click(screen.getByRole('button', { name: 'Quick actions' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([...FOUR, 'Draw one element…', ...STARTER_QUESTIONS]);
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('puts the gauge, the plus, and Send in that order on the bottom row, each an icon button with a name, eight pixels apart', () => {
    renderComposer();
    const gauge = screen.getByRole('button', { name: 'About this flow: Customer Tier Routing Flow' });
    const plus = screen.getByRole('button', { name: 'Quick actions' });
    const send = screen.getByRole('button', { name: 'Send' });
    expect(gauge.nextElementSibling).toBe(plus);
    expect(plus.nextElementSibling).toBe(send);
    // The chip sits in a wrapper that takes the row's slack, so a long model label truncates late; the wrapper is the buttons' sibling.
    const chipSlot = screen.getByText('Claude Sonnet 5').closest('.flex-1');
    expect(chipSlot).toHaveClass('min-w-0');
    expect(chipSlot?.parentElement).toBe(gauge.parentElement); // one row
    expect(chipSlot?.nextElementSibling).toBe(gauge);
    expect(gauge.parentElement).toHaveClass('gap-2'); // the same gap between the chip and the buttons as between the buttons
    expect(gauge.parentElement).not.toHaveClass('gap-1');
    for (const button of [gauge, plus, send]) expect(button).toHaveClass('h-8', 'w-8');
    expect(gauge).toHaveAttribute('type', 'button');
    expect(plus).toHaveAttribute('type', 'button');
  });

  it('shows no keyboard hint, on first focus or ever', async () => {
    renderComposer();
    const box = screen.getByLabelText('Message');
    box.focus();
    await userEvent.type(box, 'a');
    expect(screen.queryByText(/Enter to send/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Shift\+Enter/)).not.toBeInTheDocument();
  });

  it('carries no flow chip: the flow is named only by the gauge, and the box starts with the message until an element is attached', () => {
    renderComposer();
    expect(screen.queryByText('Customer Tier Routing Flow')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Message').previousElementSibling).toBeNull();
  });

  it('shows the element chip on a top row while one is attached, and Remove takes it off', async () => {
    const props = renderComposer({ element: { name: 'CheckCustomerType', label: 'Check Customer Type' } });
    expect(screen.getByText('CheckCustomerType')).toBeInTheDocument();
    expect(screen.getByLabelText('Message').previousElementSibling).toContainElement(screen.getByText('CheckCustomerType'));
    await userEvent.click(screen.getByRole('button', { name: 'Remove CheckCustomerType' }));
    expect(props.onRemoveElement).toHaveBeenCalledOnce();
  });

  it('with a key, Quick actions stays on while an answer streams, so Explain can still attach an element', () => {
    renderComposer({ busy: true });
    expect(screen.getByRole('button', { name: 'Quick actions' })).toBeEnabled();
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

  it('carries no status row, no plus, and no gauge: the link and Send are the only controls on the bottom row, the link immediately left of Send', () => {
    renderComposer({ recorded: RECORDED, chipRows: [] });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText('Your own questions need an API key.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quick actions' })).not.toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: 'Quick actions' })).not.toBeInTheDocument();
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
