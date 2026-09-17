import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

// Pill, 32px tall, hairline border, surface fill, accent-subtle on hover.
// No selected state: quick actions are not sticky.
export function Chip({ icon, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-2 rounded-pill border border-hairline bg-surface px-3 text-[14px] text-text-1 transition-colors hover:bg-accent-subtle disabled:opacity-50',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
