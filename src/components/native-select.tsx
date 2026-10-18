import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * A native `<select>`, styled like `Input` so it sits with the other controls. The repo has no
 * shadcn Select and does not need one: a native list is keyboard- and screen-reader-complete for
 * free, and opens as the platform's own menu. Every dropdown in Settings uses this one.
 */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30',
        className,
      )}
      {...props}
    />
  );
}
