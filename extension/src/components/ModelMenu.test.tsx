import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { buildPicker } from '@/lib/models';

import { ModelMenu } from './ModelMenu';

const picker = buildPicker(
  'anthropic',
  [
    { id: 'claude-sonnet-5', maxInputTokens: 1_000_000 },
    { id: 'claude-opus-5', maxInputTokens: 1_000_000 },
    { id: 'claude-haiku-4-5-20251001', maxInputTokens: 200_000 },
    { id: 'claude-sonnet-4-6', maxInputTokens: 1_000_000 },
  ],
  250_000,
);

describe('ModelMenu', () => {
  it('lists Recommended with role labels and windows, marks the current model, disables models too small for the flow, and picks', async () => {
    const onSelect = vi.fn();
    render(<ModelMenu provider="anthropic" picker={picker} currentId="claude-sonnet-5" onSelect={onSelect} onManageProviders={vi.fn()} trigger={<button type="button">Sonnet 5</button>} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sonnet 5' }));
    expect(await screen.findByText('Switching models re-sends the whole flow once.')).toBeInTheDocument();
    expect(screen.getByText('Recommended for most flows')).toBeInTheDocument();
    expect(screen.getByText('Most capable — slower and costs more')).toBeInTheDocument();
    expect(screen.getByText('too small for this flow')).toBeInTheDocument();
    expect(screen.getAllByText('1M').length).toBeGreaterThan(0);
    const haiku = screen.getByRole('menuitem', { name: /Claude Haiku 4\.5/ });
    expect(haiku).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: /More models \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Pricing/ })).toHaveAttribute('href', 'https://www.anthropic.com/pricing');

    await userEvent.click(screen.getByRole('menuitem', { name: /Claude Opus 5/ }));
    expect(onSelect).toHaveBeenCalledWith('claude-opus-5');
  });

  it('expands More models in place', async () => {
    render(<ModelMenu provider="anthropic" picker={picker} currentId="claude-sonnet-5" onSelect={vi.fn()} onManageProviders={vi.fn()} trigger={<button type="button">Open</button>} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.queryByText('Claude Sonnet 4.6')).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('menuitem', { name: /More models/ }));
    expect(await screen.findByText('Claude Sonnet 4.6')).toBeInTheDocument();
  });
});
