'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { MetricCard } from '@/components/data/metric-card';
import { PageHeader } from '@/components/data/page-header';
import { QueryState } from '@/components/data/query-state';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-context';
import { useT } from '@/lib/i18n';
import { formatDate, formatMoney } from '@/lib/utils';

export default function CabinetDashboardPage() {
  const t = useT();
  const { tenantId } = useAuth();
  const q = useQuery({
    queryKey: ['cabinet', 'dashboard', tenantId],
    queryFn: () => api.cabinet.dashboard(),
    enabled: Boolean(tenantId),
  });
  const d = q.data as {
    balance?: { availableBalance?: string; heldBalance?: string; currency?: string };
    usage?: {
      jobs?: number;
      successCount?: number;
      failureCount?: number;
      hlrCount?: number;
      pingCount?: number;
    };
    recentJobs?: Array<Record<string, unknown>>;
  } | undefined;

  return (
    <div>
      <PageHeader
        title={t('cabinetDashboard.title')}
        description={t('cabinetDashboard.description')}
        actions={
          <Link href="/app/submit">
            <Button type="button">{t('cabinetDashboard.submitCheck')}</Button>
          </Link>
        }
      />
      <QueryState
        isLoading={q.isLoading || !tenantId}
        isError={q.isError}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label={t('cabinetDashboard.available')}
            value={formatMoney(d?.balance?.availableBalance ?? '0', d?.balance?.currency ?? 'RUB')}
            hint={t('cabinetDashboard.held', {
              amount: formatMoney(d?.balance?.heldBalance ?? '0', d?.balance?.currency ?? 'RUB'),
            })}
            href="/app/billing"
          />
          <MetricCard label={t('cabinetDashboard.jobs30d')} value={d?.usage?.jobs ?? 0} href="/app/jobs" />
          <MetricCard
            label={t('cabinetDashboard.hlrPing')}
            value={`${d?.usage?.hlrCount ?? 0} / ${d?.usage?.pingCount ?? 0}`}
          />
          <MetricCard
            label={t('cabinetDashboard.successFailure')}
            value={`${d?.usage?.successCount ?? 0} / ${d?.usage?.failureCount ?? 0}`}
            tone={(d?.usage?.failureCount ?? 0) > 0 ? 'warn' : 'ok'}
          />
        </div>
        <Card className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">{t('cabinetDashboard.recentJobs')}</h2>
            <Link href="/app/jobs" className="text-xs text-[var(--color-accent)]">
              {t('cabinetDashboard.viewAll')}
            </Link>
          </div>
          <ul className="space-y-2">
            {(d?.recentJobs ?? []).map((job) => (
              <li key={String(job.id)} className="flex justify-between gap-3 text-sm">
                <Link href={`/app/jobs/${job.id}`} className="font-medium hover:underline">
                  {String(job.checkType)} · {String(job.status)}
                </Link>
                <span className="text-[var(--color-ink-muted)]">{formatDate(String(job.createdAt))}</span>
              </li>
            ))}
            {!d?.recentJobs?.length ? (
              <li className="text-sm text-[var(--color-ink-muted)]">{t('cabinetDashboard.emptyJobs')}</li>
            ) : null}
          </ul>
        </Card>
      </QueryState>
    </div>
  );
}
