import { cn } from '@/lib/cn';

import { Tip } from './ui/tooltip';

export interface VersionInfo {
  /** The version the panel is chatting about. */
  version: number;
  status: string;
  /** The definition's latest saved version, when known. */
  latestNumber: number | null;
  /** The definition's active version, when any. */
  activeNumber: number | null;
}

export type ChipTone = 'success' | 'neutral' | 'warning';

export function chipTone(status: string): ChipTone {
  if (status === 'Active') return 'success';
  if (status === 'Draft') return 'neutral';
  return 'warning';
}

export function statusWord(status: string): string {
  if (status === 'InvalidDraft') return 'Invalid draft';
  return status;
}

export function versionTooltip({ version, status, latestNumber, activeNumber }: VersionInfo): string {
  const word = statusWord(status);
  const opening =
    latestNumber !== null && latestNumber !== version
      ? `You're chatting about v${version} (${word}). The latest saved version is v${latestNumber}.`
      : `You're chatting about the latest saved version (v${version}, ${word}).`;
  const active =
    activeNumber === null
      ? 'Your org has no active version of this flow.'
      : activeNumber === version
        ? "It's also the active version in your org."
        : `The active version in your org is v${activeNumber}.`;
  return `${opening} ${active}`;
}

const TONE_CLASS: Record<ChipTone, string> = {
  success: 'fill-success-subtle text-text-1',
  neutral: 'bg-surface text-text-2',
  warning: 'fill-warning-subtle text-text-1',
};

const DOT_CLASS: Record<ChipTone, string> = {
  success: 'bg-success',
  neutral: 'bg-text-3',
  warning: 'bg-warning',
};

export function VersionChip({ info, savedAgo }: { info: VersionInfo; savedAgo: string }) {
  const tone = chipTone(info.status);
  const label = `v${info.version} · ${statusWord(info.status)}`;
  const tooltip = savedAgo ? `${versionTooltip(info)} ${savedAgo}.` : versionTooltip(info);
  return (
    <Tip content={tooltip}>
      <button type="button" className="inline-flex shrink-0 cursor-default items-center rounded-pill" aria-label={`${label}. ${tooltip}`}>
        <span
          className={cn(
            'h-6 items-center whitespace-nowrap rounded-pill border border-hairline px-2 text-xs font-medium @max-[359px]:hidden @min-[360px]:inline-flex',
            TONE_CLASS[tone],
          )}
        >
          {label}
        </span>
        <span className={cn('h-2 w-2 rounded-full @min-[360px]:hidden', DOT_CLASS[tone])} aria-hidden="true" />
      </button>
    </Tip>
  );
}
