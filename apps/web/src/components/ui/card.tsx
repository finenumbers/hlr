import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--color-line)] bg-[var(--color-panel-elevated)] p-5 shadow-[0_1px_0_rgba(20,32,51,0.04)]',
        className,
      )}
      {...props}
    />
  );
}
