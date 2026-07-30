import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function MetricCard({
  label,
  value,
  hint,
  href,
  tone,
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
  tone?: 'default' | 'danger' | 'ok' | 'warn';
  className?: string;
}) {
  const toneClass =
    tone === 'danger'
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
        className,
      )}
    >
      <p className="text-xs font-bold text-[var(--color-ink-muted)]">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{hint}</p> : null}
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
