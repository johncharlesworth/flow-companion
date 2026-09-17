import type { ButtonHTMLAttributes, Ref } from 'react';

import { cn } from '@/lib/cn';

// One primary (accent fill) and one ghost (icon buttons). No outline variant.
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost';
  size?: 'md' | 'icon';
  ref?: Ref<HTMLButtonElement>;
}

const VARIANT = {
  primary: 'bg-accent text-accent-fg hover:opacity-90',
  ghost: 'text-text-2 hover:bg-accent-subtle hover:text-text-1',
} as const;

const SIZE = {
  md: 'h-9 px-4',
  icon: 'h-8 w-8',
} as const;

export function Button({ variant = 'primary', size = 'md', className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-button text-[14px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    />
  );
}
