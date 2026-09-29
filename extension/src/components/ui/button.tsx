import type { ButtonHTMLAttributes, Ref } from 'react';

import { cn } from '@/lib/cn';

// Four variants: primary (accent fill), ghost (icon buttons), chip (a labelled toolbar control) and link (accent
// text). No outline variant.
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'chip' | 'link';
  size?: 'md' | 'icon' | 'chip' | 'link';
  ref?: Ref<HTMLButtonElement>;
}

const VARIANT = {
  primary: 'bg-accent text-accent-fg hover:opacity-90',
  ghost: 'text-text-2 hover:bg-accent-subtle hover:text-text-1',
  // A labelled control on the message box's toolbar: reads in the body ink
  // rather than the quieter text-2, so it does not look disabled beside the
  // model name, and keeps the same accent hover as ghost.
  chip: 'text-text-1 hover:bg-accent-subtle',
  // A secondary action in the accent ink: the next step on an error card, or
  // "Try again" under a picture that would not draw. Its own variant because a
  // className text-accent on ghost loses to ghost's text-text-2 (cn() is plain
  // clsx), which would leave these grey, reading as body text.
  link: 'text-accent hover:bg-accent-subtle',
} as const;

const SIZE = {
  md: 'h-9 gap-2 px-4 text-[14px] font-medium',
  icon: 'h-8 w-8 gap-2 text-[14px] font-medium',
  // A labelled control the height of an icon button. Its own size rather than
  // md-with-overrides, because cn() is plain clsx: a utility in className does
  // not beat one in the base, and which wins is down to Tailwind's order. The
  // type, the weight, the padding and the gap therefore live here, never in
  // the base. Explicit pixels, trimmed so that at 320px the default model's
  // name still fits whole beside it: 7px before the label, 4px to the
  // chevron, 5px after it.
  chip: 'h-8 gap-[4px] pl-[7px] pr-[5px] text-[13px] font-normal',
  // The link variant's size on an error card: 7px of padding, so a link leading the row can pull
  // its words level with the card's text (-ml-[7px]) and keep its hover fill inside the card.
  link: 'h-9 gap-2 px-[7px] text-[14px] font-medium',
} as const;

export function Button({ variant = 'primary', size = 'md', className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-button transition-colors disabled:pointer-events-none disabled:opacity-50',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    />
  );
}
