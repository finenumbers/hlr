'use client';

import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

export function QueryState({
  isLoading,
  isError,
  error,
  isEmpty,
  emptyTitle,
  emptyDescription,
  onRetry,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  error?: Error | null;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  onRetry?: () => void;
  children: ReactNode;
}) {
  const t = useT();

  if (isLoading) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-line)] p-8 text-sm text-[var(--color-ink-muted)]">
        {t('common.loading')}
      </div>
    );
  }
  if (isError) {
    return (
      <div className="rounded-xl border border-[var(--color-danger)]/30 bg-[color-mix(in_oklab,var(--color-danger)_8%,transparent)] p-6">
        <p className="text-sm font-medium text-[var(--color-danger)]">
          {error?.message ?? t('common.queryError')}
        </p>
        {onRetry ? (
          <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        ) : null}
      </div>
    );
  }
  if (isEmpty) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-line)] p-8">
        <p className="font-medium">{emptyTitle ?? t('common.queryEmpty')}</p>
        {emptyDescription ? (
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{emptyDescription}</p>
        ) : null}
      </div>
    );
  }
  return <>{children}</>;
}
