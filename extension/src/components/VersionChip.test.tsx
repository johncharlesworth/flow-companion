import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TooltipProvider } from './ui/tooltip';
import { chipTone, statusWord, VersionChip, versionTooltip } from './VersionChip';

describe('version chip', () => {
  it.each([
    ['Active', 'success'],
    ['Draft', 'neutral'],
    ['Obsolete', 'warning'],
    ['InvalidDraft', 'warning'],
  ])('%s -> %s tone', (status, tone) => {
    expect(chipTone(status)).toBe(tone);
  });

  it('spells InvalidDraft for humans', () => {
    expect(statusWord('InvalidDraft')).toBe('Invalid draft');
    expect(statusWord('Draft')).toBe('Draft');
  });

  it('tooltip: latest saved draft with an older active version', () => {
    expect(versionTooltip({ version: 4, status: 'Draft', latestNumber: 4, activeNumber: 3 })).toBe(
      "You're chatting about the latest saved version (v4, Draft). The active version in your org is v3.",
    );
  });

  it('tooltip: the version is active, or there is no active version, or it is not the latest', () => {
    expect(versionTooltip({ version: 4, status: 'Active', latestNumber: 4, activeNumber: 4 })).toBe(
      "You're chatting about the latest saved version (v4, Active). It's also the active version in your org.",
    );
    expect(versionTooltip({ version: 1, status: 'Draft', latestNumber: 1, activeNumber: null })).toBe(
      "You're chatting about the latest saved version (v1, Draft). Your org has no active version of this flow.",
    );
    expect(versionTooltip({ version: 2, status: 'Obsolete', latestNumber: 5, activeNumber: 5 })).toBe(
      "You're chatting about v2 (Obsolete). The latest saved version is v5. The active version in your org is v5.",
    );
  });

  it('renders the label and an accessible name that includes the tooltip', () => {
    render(
      <TooltipProvider>
        <VersionChip info={{ version: 4, status: 'Draft', latestNumber: 4, activeNumber: 3 }} savedAgo="Saved 3 min ago" />
      </TooltipProvider>,
    );
    expect(screen.getByText('v4 · Draft')).toBeInTheDocument();
    expect(screen.getByLabelText(/v4 · Draft\. You're chatting about the latest saved version .* Saved 3 min ago\./)).toBeInTheDocument();
  });
});
