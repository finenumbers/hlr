import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export function Badge({
  className,
  tone = 'neutral',
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' }) {
  const tones = {
    neutral: 'bg-[var(--color-line)] text-[var(--color-ink)]',
    ok: 'bg-[color-mix(in_oklab,var(--color-ok)_20%,transparent)] text-[var(--color-ok)]',
    warn: 'bg-[color-mix(in_oklab,var(--color-warn)_20%,transparent)] text-[var(--color-warn)]',
    danger: 'bg-[color-mix(in_oklab,var(--color-danger)_18%,transparent)] text-[var(--color-danger)]',
    accent: 'bg-[var(--color-accent)] text-[var(--color-on-accent)]',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
