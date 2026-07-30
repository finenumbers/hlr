import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function MetricCard({
  label,
  value,
  hint,
  href,
  tone,
  surface = 'default',
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
  tone?: 'default' | 'danger' | 'ok' | 'warn';
  surface?: 'default' | 'accent';
  className?: string;
}) {
  const isAccent = surface === 'accent';

  const toneClass = isAccent
    ? '!text-black'
    : tone === 'danger'
      ? 'text-[var(--color-danger)]'
      : tone === 'ok'
        ? 'text-[var(--color-ok)]'
        : tone === 'warn'
          ? 'text-[var(--color-warn)]'
          : 'text-[var(--color-ink)]';

  const body = (
    <Card
      className={cn(
        'h-full',
        href ? 'transition hover:border-[var(--color-accent)]' : undefined,
        isAccent &&
          'border-transparent bg-[var(--color-accent-bright)] text-black hover:border-transparent',
        className,
      )}
    >
      <p
        className={cn(
          'text-xs font-bold',
          isAccent ? '!text-black' : 'text-[var(--color-ink-muted)]',
        )}
      >
        {label}
      </p>
      <p className={cn('mt-2 text-3xl font-semibold tabular-nums', toneClass)}>{value}</p>
      {hint ? (
        <p className={cn('mt-1 text-xs', isAccent ? '!text-black/70' : 'text-[var(--color-ink-muted)]')}>
          {hint}
        </p>
      ) : null}
    </Card>
  );

  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}
