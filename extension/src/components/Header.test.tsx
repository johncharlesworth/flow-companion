import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Header, type HeaderFlow } from './Header';
import { TooltipProvider } from './ui/tooltip';

const NOW = Date.parse('2026-09-03T12:03:00.000Z');
const flow: HeaderFlow = {
  label: 'Customer Tier Routing Flow',
  version: 4,
  status: 'Draft',
  latestNumber: 4,
  activeNumber: 3,
  lastModified: '2026-09-03T12:00:00.000Z',
};

const renderHeader = (props: Partial<Parameters<typeof Header>[0]> = {}) =>
  render(
    <TooltipProvider>
      <Header flow={flow} onOpenSettings={vi.fn()} now={NOW} {...props} />
    </TooltipProvider>,
  );

describe('Header', () => {
  it('shows the flow label as the only h1, the version chip, and when it was saved', () => {
    renderHeader();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Customer Tier Routing Flow');
    expect(screen.getByText('v4 · Draft')).toBeInTheDocument();
    expect(screen.getByText('Saved 3 min ago')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  });

  it('falls back to the product name with only the menu when no flow is loaded', () => {
    renderHeader({ flow: null });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Flow Companion');
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
  });

  it('Refresh calls the handler and is disabled while refreshing', async () => {
    const onRefresh = vi.fn();
    const { rerender } = renderHeader({ onRefresh });
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    rerender(
      <TooltipProvider>
        <Header flow={flow} onOpenSettings={vi.fn()} now={NOW} onRefresh={onRefresh} refreshing />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  });

  it('the menu offers Download JSON and Settings, and Settings opens the settings view', async () => {
    const onOpenSettings = vi.fn();
    const onDownloadJson = vi.fn();
    renderHeader({ onOpenSettings, onDownloadJson });
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(await screen.findByRole('menuitem', { name: 'Download JSON' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
