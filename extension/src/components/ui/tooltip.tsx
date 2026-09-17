import { Tooltip } from '@base-ui/react/tooltip';
import type { ReactElement, ReactNode } from 'react';

/** Shared hover delay: quicker than Base UI's 600 ms default, so icon buttons explain themselves before the user gives up. */
const HOVER_DELAY_MS = 300;

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <Tooltip.Provider delay={HOVER_DELAY_MS}>{children}</Tooltip.Provider>;
}

// Wrap a single element; the tooltip's behaviour merges onto it.
export function Tip({
  content,
  side = 'bottom',
  disabled = false,
  children,
}: {
  content: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Quiet while something else (a pinned popover) shows the same content; the trigger stays mounted. */
  disabled?: boolean;
  children: ReactElement;
}) {
  return (
    <Tooltip.Root disabled={disabled}>
      <Tooltip.Trigger render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner side={side} sideOffset={6} className="z-50">
          <Tooltip.Popup role="tooltip" className="max-w-[280px] rounded-button bg-surface-elevated px-3 py-2 text-xs leading-[1.45] text-text-1 shadow-elevated">
            {content}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
