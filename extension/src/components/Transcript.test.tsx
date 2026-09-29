import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import syntheticFlow from '../../test/fixtures/synthetic-flow.json';
import type { ChatTurn } from '@/hooks/useChatStream';

import { DIAGRAM_FAILED } from './FlowDiagram';
import { DIAGRAM_FOOTER, Transcript, type TranscriptProps, UNKNOWN_NAMES, WAITING } from './Transcript';
import { TooltipProvider } from './ui/tooltip';

// The two on-demand modules need a real browser; here they are scripted.
vi.mock('@/lib/mermaid-render.lazy', () => ({
  renderDiagram: async (text: string) => {
    if (text.includes('BROKEN')) throw new Error('Parse error');
    return '<svg data-test="drawn"><g class="node"></g></svg>';
  },
}));
vi.mock('@/lib/excalidraw-export.lazy', () => ({ toExcalidrawClipboard: async () => JSON.stringify({ type: 'excalidraw-api/clipboard', elements: [{ type: 'rectangle' }] }) }));

// The interruption contract and the footer lines, as the transcript renders
// them.

function renderTranscript(turns: ChatTurn[], over: Partial<TranscriptProps> = {}) {
  const props: TranscriptProps = {
    turns,
    status: 'idle',
    provider: 'anthropic',
    currentModelLabel: 'Claude Sonnet 5',
    onRetry: vi.fn(),
    onContinue: vi.fn(),
    onErrorAction: vi.fn(),
    onDownloadDocument: vi.fn(),
    onRedo: vi.fn(),
    flowMetadata: syntheticFlow,
    ...over,
  };
  render(
    <TooltipProvider>
      <Transcript {...props} />
    </TooltipProvider>,
  );
  return props;
}

const question = (text: string, extra: Partial<ChatTurn> = {}): ChatTurn => ({ id: `u-${text}`, role: 'user', displayText: text, sentText: text, mode: 'ask', timestamp: 1, ...extra });
const answer = (extra: Partial<ChatTurn>): ChatTurn => ({ id: 'a', role: 'assistant', displayText: 'The decision compares the account type.', timestamp: 2, ...extra });

describe('Transcript', () => {
  it('a hydrated interrupted answer (panel closed or tab switched mid-stream) shows "Interrupted · Retry" and no error card', async () => {
    const props = renderTranscript([question('And the fault path?'), answer({ interrupted: 'error' })]);
    expect(screen.getByText('Interrupted')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(props.onRetry).toHaveBeenCalledOnce();
  });

  it('a stopped answer shows "Stopped" and no Retry; stopped before any word arrived, it says so', () => {
    renderTranscript([question('Why does it branch?'), answer({ interrupted: 'stopped' })]);
    expect(screen.getByText('Stopped')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    render(
      <TooltipProvider>
        <Transcript turns={[question('Document this flow', { id: 'u2', mode: 'document' }), answer({ id: 'b', displayText: '', interrupted: 'stopped' })]} status="idle" provider="anthropic" currentModelLabel="Claude Sonnet 5" onRetry={vi.fn()} onContinue={vi.fn()} onErrorAction={vi.fn()} onDownloadDocument={vi.fn()} onRedo={vi.fn()} flowMetadata={syntheticFlow} />
      </TooltipProvider>,
    );
    expect(screen.getByText('Stopped before anything arrived.')).toBeInTheDocument();
  });

  it('an error with a known class shows its card with one action, and only one Retry control', async () => {
    const props = renderTranscript([question('Q'), answer({ interrupted: 'error', error: { class: 'interrupted' } })]);
    expect(screen.getByRole('alert')).toHaveTextContent('Connection dropped');
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(props.onRetry).toHaveBeenCalledOnce();

    render(
      <TooltipProvider>
        <Transcript {...props} turns={[question('Q2'), answer({ id: 'b', interrupted: 'error', error: { class: 'keyRejected' } })]} />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: 'Open Settings' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1); // still only the first transcript's
  });

  it('a Document answer that hit its length limit keeps the Copy · Download bar and offers Continue', async () => {
    const props = renderTranscript([question('Document this flow', { mode: 'document' }), answer({ displayText: '# Flow\n\nSome text.', stopReason: 'max_tokens' })]);
    expect(screen.getByText('Answer was cut off')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(props.onDownloadDocument).toHaveBeenCalledWith('# Flow\n\nSome text.');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(props.onContinue).toHaveBeenCalledOnce();
  });

  it('a quick-action question renders as a pill plus the element name, never an empty bubble', () => {
    renderTranscript([question('', { mode: 'explain', focusElement: 'CheckCustomerType' }), answer({ stopReason: 'end' })]);
    expect(screen.getByText('Explain')).toBeInTheDocument();
    expect(screen.getByText('CheckCustomerType')).toBeInTheDocument();
    expect(screen.queryByText('Interrupted')).not.toBeInTheDocument();
  });
});

describe('Transcript · the latest answer', () => {
  it('an answer cut off before a word arrived, or halfway through a picture, offers Retry, not Continue: there is nothing to continue', async () => {
    const empty = renderTranscript([question('Draw it anyway'), answer({ displayText: '', stopReason: 'max_tokens' })]);
    expect(screen.getByText('The answer was cut off before it began')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(empty.onRedo).toHaveBeenCalledOnce();
    expect(empty.onContinue).not.toHaveBeenCalled();
    cleanup();

    const half = renderTranscript([question('Draw every element', { mode: 'draw' }), answer({ displayText: '```mermaid\nflowchart TD\n  A["Start"] --> B', stopReason: 'max_tokens' })]);
    expect(screen.getByText('The picture was cut off before it was finished')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(half.onRedo).toHaveBeenCalledOnce();
  });

  it('Retry and Continue sit under the latest answer only: under an earlier one they would do nothing, or continue the wrong answer', () => {
    renderTranscript([
      question('First'),
      answer({ id: 'a1', displayText: 'Cut off here', stopReason: 'max_tokens' }),
      question('Second'),
      answer({ id: 'a2', displayText: 'Half an', interrupted: 'error' }),
    ]);
    expect(screen.getByText('Answer was cut off')).toBeInTheDocument(); // the earlier answer keeps its words
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument(); // but not the link
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1); // the latest one's
  });

  it('a note after the latest answer does not make it earlier, and while it streams it shows no footer at all', () => {
    const turns: ChatTurn[] = [question('Why?'), answer({ id: 'a1', displayText: 'word1 word2', interrupted: 'error' }), { id: 'n1', role: 'notice', displayText: 'Flow updated to v5 (Draft)', timestamp: 3 }];
    renderTranscript(turns, { status: 'streaming' });
    expect(screen.queryByText('Interrupted')).not.toBeInTheDocument(); // still arriving, not interrupted
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('with sending blocked (the flow will not fit the chosen model), the latest failed answer offers no Retry', () => {
    renderTranscript([question('Why?'), answer({ id: 'a1', displayText: '', interrupted: 'error', error: { class: 'providerBusy' } })], { sendBlocked: true });
    expect(screen.getByText('Busy right now')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('an earlier card whose only action was Retry keeps its words and no empty button row', () => {
    renderTranscript([question('First'), answer({ id: 'a1', displayText: '', interrupted: 'error', error: { class: 'providerBusy' } }), question('Second'), answer({ id: 'a2', displayText: 'Answered.' })]);
    const card = screen.getByRole('alert');
    expect(card).toHaveTextContent('Busy right now');
    expect(card.querySelectorAll('button, div')).toHaveLength(0);
  });

  it('while an answer arrives, an earlier card offers no way to pick a model; once idle it does, with Retry only on the latest', () => {
    const turns: ChatTurn[] = [question('First'), answer({ id: 'a1', displayText: '', interrupted: 'error', error: { class: 'modelUnavailable' } }), question('Second'), answer({ id: 'a2', displayText: 'arriving' })];
    renderTranscript(turns, { status: 'streaming' });
    expect(screen.queryByRole('button', { name: 'Open model menu' })).not.toBeInTheDocument();
  });

  it('while another answer arrives, the latest finished one offers no Retry', () => {
    renderTranscript([question('First'), answer({ id: 'a1', displayText: 'Half an', interrupted: 'error' }), question('Second'), answer({ id: 'a2', displayText: 'arriving' })], { status: 'streaming' });
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});

describe('Transcript · Draw this flow', () => {
  const DIAGRAM = '```mermaid\nflowchart TD\n  A["Account is updated"] --> B{"Enterprise account?"}\n  B -->|Yes| C["Update the account"]\n```\n\nOne decision.';
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

  it('under a rendered diagram: the footer, and Open in Excalidraw with its line and hint; no follow-up chips', async () => {
    writeText.mockClear();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderTranscript([question('', { mode: 'draw', variant: 'business' }), answer({ displayText: DIAGRAM, stopReason: 'end' })]);
    expect(screen.getByText('Draw')).toBeInTheDocument(); // the pill
    await waitFor(() => expect(screen.getByText(DIAGRAM_FOOTER('Anthropic'))).toBeInTheDocument());
    expect(screen.queryByText(/Names not in this flow/)).not.toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument(); // one button only; Mermaid is a link in the sentence
    await userEvent.click(screen.getByRole('button', { name: 'copy the Mermaid text' }));
    expect(writeText).toHaveBeenLastCalledWith('flowchart TD\n  A["Account is updated"] --> B{"Enterprise account?"}\n  B -->|Yes| C["Update the account"]');
    expect(screen.getByRole('button', { name: 'copied' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Open in Excalidraw' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Copied\. Press (⌘V|Ctrl\+V) on the Excalidraw canvas\./));
    expect(screen.getByText(/Opens excalidraw\.com in a new tab with the picture on your clipboard\. Paste it there with (⌘V|Ctrl\+V) to edit it\. Or/)).toHaveTextContent(/to use it elsewhere\.$/);
    expect(JSON.parse(writeText.mock.calls.at(-1)?.[0] as unknown as string) as { type: string }).toMatchObject({ type: 'excalidraw-api/clipboard' });
    expect(open).toHaveBeenCalledWith('https://excalidraw.com/', '_blank', 'noopener');
    // The clipboard was written before the tab opened.
    expect(writeText.mock.invocationCallOrder.at(-1)!).toBeLessThan(open.mock.invocationCallOrder[0]!);

    // The other pictures are in the Actions menu, not under each one.
    expect(screen.queryByRole('button', { name: 'Draw every element' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Draw one element' })).not.toBeInTheDocument();
    open.mockRestore();
  });

  it('a picture in an ordinary typed answer gets the same footer and bar', async () => {
    renderTranscript([question('Draw the enterprise branch'), answer({ displayText: DIAGRAM, stopReason: 'end' })]);
    await waitFor(() => expect(screen.getByText(DIAGRAM_FOOTER('Anthropic'))).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Open in Excalidraw' })).toBeInTheDocument();
    expect(screen.queryByText('Draw')).not.toBeInTheDocument(); // no pill: it was typed
  });

  it('the every-element picture is not called simplified, and names anything the flow does not have', async () => {
    const admin = '```mermaid\nflowchart TD\n  Start --> CheckCustomerType{"CheckCustomerType"}\n  CheckCustomerType -->|Enterprise| Delete_Everything["Delete_Everything"]\n```';
    renderTranscript([question('Draw every element', { mode: 'draw', variant: 'admins' }), answer({ displayText: admin, stopReason: 'end' })]);
    await waitFor(() => expect(screen.getByText(new RegExp(UNKNOWN_NAMES(['Delete_Everything']).replace(/[.]/g, '\\.')))).toBeInTheDocument());
    expect(screen.getByText(/^Drawn by Anthropic from the saved version/)).toBeInTheDocument(); // not "simplified": it shows everything
  });

  it('a diagram that will not draw: the line, the text, Try again re-sends, and no footer or bar', async () => {
    const props = renderTranscript([question('', { mode: 'draw', variant: 'business' }), answer({ displayText: '```mermaid\nflowchart TD\n  A[BROKEN --> \n```', stopReason: 'end' })]);
    await waitFor(() => expect(screen.getByText(DIAGRAM_FAILED)).toBeInTheDocument());
    expect(screen.queryByText(DIAGRAM_FOOTER('Anthropic'))).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open in Excalidraw' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(props.onRedo).toHaveBeenCalledOnce();
  });

  it('an older diagram that failed has no Try again (only the last question can be re-sent)', async () => {
    renderTranscript([
      question('', { mode: 'draw', variant: 'business' }),
      answer({ displayText: '```mermaid\nflowchart TD\n  A[BROKEN --> \n```', stopReason: 'end' }),
      question('And then?', { id: 'u2' }),
      answer({ id: 'a2', displayText: 'Then it ends.', stopReason: 'end' }),
    ]);
    await waitFor(() => expect(screen.getByText(DIAGRAM_FAILED)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});

describe('Transcript · the waiting row', () => {
  it('says Drawing while a picture is on its way, and after 20 seconds how long one can take', () => {
    vi.useFakeTimers();
    try {
      renderTranscript([question('', { mode: 'draw', variant: 'business' }), answer({ displayText: '' })], { status: 'waiting' });
      expect(screen.getByRole('status')).toHaveTextContent(WAITING.drawing);
      expect(screen.queryByText(WAITING.longDrawing)).not.toBeInTheDocument();
      act(() => vi.advanceTimersByTime(21_000));
      expect(screen.getByRole('status')).toHaveTextContent(`${WAITING.drawing} 21s`);
      expect(screen.getByText(WAITING.longDrawing)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says Writing the document for a Document question, and after 20 seconds how long one can take', () => {
    vi.useFakeTimers();
    try {
      renderTranscript([question('', { mode: 'document' }), answer({ displayText: '' })], { status: 'waiting' });
      expect(screen.getByRole('status')).toHaveTextContent(WAITING.writing);
      act(() => vi.advanceTimersByTime(21_000));
      expect(screen.getByText(WAITING.longWriting)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says Thinking for every other question, with the model line after 20 seconds', () => {
    vi.useFakeTimers();
    try {
      renderTranscript([question('Why does it branch?'), answer({ displayText: '' })], { status: 'waiting' });
      expect(screen.getByRole('status')).toHaveTextContent(WAITING.thinking);
      act(() => vi.advanceTimersByTime(21_000));
      expect(screen.getByText(WAITING.longAnswer)).toBeInTheDocument();
      expect(screen.queryByText(WAITING.longDrawing)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
