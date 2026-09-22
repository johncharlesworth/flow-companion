import { render, screen } from '@testing-library/react';
import { KeyRound } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { PanelState } from './PanelState';

describe('PanelState', () => {
  it('shows the title, the sentence, the note and the one action, and no link unless it is given one', () => {
    render(<PanelState icon={KeyRound} title="Set up your AI" body="Paste a key." note="A quieter line." action={{ label: 'Set up your AI', onClick: vi.fn() }} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Set up your AI');
    expect(screen.getByText('Paste a key.')).toBeInTheDocument();
    expect(screen.getByText('A quieter line.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up your AI' })).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders the link after the action, opening in a new tab, with its note under it', () => {
    render(
      <PanelState
        icon={KeyRound}
        title="Set up your AI"
        body="Paste a key."
        action={{ label: 'Set up your AI', onClick: vi.fn() }}
        link={{ label: 'See it on a demo flow first', href: '/sidepanel.html?demo=1', note: 'No key needed. Opens in a new tab.' }}
      />,
    );
    const link = screen.getByRole('link', { name: 'See it on a demo flow first' });
    expect(link).toHaveAttribute('href', '/sidepanel.html?demo=1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    const button = screen.getByRole('button', { name: 'Set up your AI' });
    expect(button.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const note = screen.getByText('No key needed. Opens in a new tab.');
    expect(link.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a link needs no action and no note', () => {
    render(<PanelState icon={KeyRound} title="Not on Salesforce" body="Open a Salesforce org." link={{ label: 'Try a demo flow', href: '/sidepanel.html?demo=1' }} />);
    expect(screen.getByRole('link', { name: 'Try a demo flow' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
