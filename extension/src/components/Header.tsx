import { Download, EllipsisVertical, RefreshCw, Settings, SquarePen } from 'lucide-react';

import { cn } from '@/lib/cn';
import { formatSavedAgo } from '@/lib/relative-time';

import { Button } from './ui/button';
import { ActionMenu } from './ui/menu';
import { Tip } from './ui/tooltip';
import { VersionChip, type VersionInfo } from './VersionChip';

export interface HeaderFlow extends VersionInfo {
  label: string;
  lastModified: string;
}

export interface HeaderProps {
  flow: HeaderFlow | null;
  refreshing?: boolean;
  onNewChat?: () => void;
  onRefresh?: () => void;
  onDownloadJson?: () => void;
  onOpenSettings: () => void;
  now?: number;
}

// One row: the flow's name is the only title on screen. Everything else is quieter.
export function Header({ flow, refreshing = false, onNewChat, onRefresh, onDownloadJson, onOpenSettings, now }: HeaderProps) {
  const savedAgo = flow ? formatSavedAgo(flow.lastModified, now) : '';
  const title = flow?.label ?? 'Flow Companion';
  const heading = (
    <h1 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-text-1" title={flow ? undefined : title}>
      {title}
    </h1>
  );
  return (
    <header className="@container flex h-11 shrink-0 items-center gap-2 px-3">
      {flow ? <Tip content={flow.label}>{heading}</Tip> : heading}
      {flow && (
        <>
          <VersionChip info={flow} savedAgo={savedAgo} />
          {savedAgo && <span className="whitespace-nowrap text-xs text-text-3 @max-[399px]:hidden">{savedAgo}</span>}
          <Tip content="New chat. The flow stays attached; the first question in a new chat sends it again.">
            <Button variant="ghost" size="icon" aria-label="New chat" onClick={onNewChat}>
              <SquarePen className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Tip>
          <Tip content="Save in Builder, then refresh">
            <Button variant="ghost" size="icon" aria-label="Refresh" onClick={onRefresh} disabled={refreshing}>
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} aria-hidden="true" />
            </Button>
          </Tip>
        </>
      )}
      <ActionMenu
        trigger={
          <Button variant="ghost" size="icon" aria-label="More">
            <EllipsisVertical className="h-4 w-4" aria-hidden="true" />
          </Button>
        }
        items={[
          {
            label: 'Download JSON',
            icon: <Download className="h-4 w-4 text-text-2" aria-hidden="true" />,
            onSelect: () => onDownloadJson?.(),
            disabled: !flow || !onDownloadJson,
          },
          {
            label: 'Settings',
            icon: <Settings className="h-4 w-4 text-text-2" aria-hidden="true" />,
            onSelect: onOpenSettings,
          },
        ]}
      />
    </header>
  );
}
