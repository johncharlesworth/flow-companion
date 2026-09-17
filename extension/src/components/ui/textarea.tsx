import type { Ref, TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export function Textarea({ className, ref, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'w-full resize-none rounded-composer border border-hairline bg-composer px-3 py-2 text-[14px] leading-[1.55] text-text-1 placeholder:text-text-3',
        className,
      )}
      {...rest}
    />
  );
}
