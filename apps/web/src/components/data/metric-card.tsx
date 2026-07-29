import Link from 'next/link';

import { Card } from '@/components/ui/card';

export function MetricCard({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
  tone?: 'default' | 'danger' | 'ok' | 'warn';
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
    <Card className={href ? 'transition hover:border-[var(--color-accent)]' : undefined}>
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
        {label}
      </p>
      <p className={`mt-2 text-3xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{hint}</p> : null}
    </Card>
  );

  return href ? <Link href={href}>{body}</Link> : body;
}
