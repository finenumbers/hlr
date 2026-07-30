'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { MetricCard } from '@/components/data/metric-card';
import { PageHeader } from '@/components/data/page-header';
import { QueryState } from '@/components/data/query-state';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api/client';
import { useT } from '@/lib/i18n';
import { formatDate, formatMoney } from '@/lib/utils';

export default function AdminDashboardPage() {
  const t = useT();
  const q = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: () => api.admin.dashboard(),
  });

  const d = q.data as {
    health?: {
      providerConfigured?: boolean;
      webhookDeadLetter24h?: number;
      stuckJobs?: number;
      queue?: Record<string, number>;
    };
    volume?: {
      tenantsTotal?: number;
      tenantsActive?: number;
      tenantsSuspended?: number;
      tenantsInactive?: number;
      tenantsLowBalance?: number;
      jobs24h?: number;
      hlrItems24h?: number;
      pingItems24h?: number;
    };
    money?: { capturedDebit24h?: string; currency?: string };
    provider?: {
      smscBalance?: { balance?: string; currency?: string; checkedAt?: string } | null;
    };
    problems?: {
      providerErrorRatePct?: number;
      stuckJobs?: Array<Record<string, unknown>>;
      failedJobs?: Array<Record<string, unknown>>;
    };
  } | undefined;

  const smsc = d?.provider?.smscBalance;

  return (
    <div>
      <PageHeader title={t('adminDashboard.title')} description={t('adminDashboard.description')} />
      <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => void q.refetch()}>
        <div className="mb-4 flex flex-wrap gap-2">
          <Badge tone={d?.health?.providerConfigured ? 'ok' : 'warn'}>
            {d?.health?.providerConfigured
              ? t('adminDashboard.providerReady')
              : t('adminDashboard.providerUnconfigured')}
          </Badge>
          <Badge tone={(d?.health?.stuckJobs ?? 0) > 0 ? 'warn' : 'ok'}>
            {t('adminDashboard.stuckJobs', { count: d?.health?.stuckJobs ?? 0 })}
          </Badge>
          <Badge tone={(d?.health?.webhookDeadLetter24h ?? 0) > 0 ? 'danger' : 'ok'}>
            {t('adminDashboard.deadWebhooks', { count: d?.health?.webhookDeadLetter24h ?? 0 })}
          </Badge>
          <Badge
            tone={(d?.problems?.providerErrorRatePct ?? 0) > 5 ? 'danger' : 'neutral'}
          >
            {t('adminDashboard.providerErrors', { pct: d?.problems?.providerErrorRatePct ?? 0 })}
          </Badge>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label={t('adminDashboard.clientsCard')}
            value={`${d?.volume?.tenantsTotal ?? 0} / ${d?.volume?.tenantsLowBalance ?? 0}`}
            hint={t('adminDashboard.clientsCardHint', {
              active: d?.volume?.tenantsActive ?? 0,
              inactive: d?.volume?.tenantsInactive ?? 0,
            })}
            href="/admin/tenants"
          />
          <MetricCard
            label={t('adminDashboard.jobs24h')}
            value={d?.volume?.jobs24h ?? 0}
            hint={t('adminDashboard.jobs24hHint', {
              hlr: d?.volume?.hlrItems24h ?? 0,
              ping: d?.volume?.pingItems24h ?? 0,
            })}
            href="/admin/jobs"
          />
          <MetricCard
            label={t('adminDashboard.capturedDebit')}
            value={formatMoney(d?.money?.capturedDebit24h ?? '0', d?.money?.currency ?? 'RUB')}
            hint={t('adminDashboard.capturedDebitHint')}
            href="/admin/audit?action=billing.wallet."
          />
          <MetricCard
            surface="accent"
            label={t('adminDashboard.smscBalance')}
            value={
              smsc?.balance != null
                ? formatMoney(smsc.balance, smsc.currency ?? 'RUB')
                : t('common.dash')
            }
            hint={
              smsc?.checkedAt
                ? t('adminDashboard.smscBalanceHint', {
                    when: formatDate(smsc.checkedAt),
                  })
                : t('adminDashboard.smscBalanceEmpty')
            }
            href="/admin/monitoring"
          />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">{t('adminDashboard.stuckJobsTitle')}</h2>
              <Link href="/admin/jobs?status=PROCESSING" className="text-xs text-[var(--color-accent)]">
                {t('adminDashboard.viewAll')}
              </Link>
            </div>
            <ProblemList rows={d?.problems?.stuckJobs ?? []} />
          </Card>
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">{t('adminDashboard.failedJobsTitle')}</h2>
              <Link href="/admin/jobs?status=FAILED" className="text-xs text-[var(--color-accent)]">
                {t('adminDashboard.viewAll')}
              </Link>
            </div>
            <ProblemList rows={d?.problems?.failedJobs ?? []} />
          </Card>
        </div>
      </QueryState>
    </div>
  );
}

function ProblemList({ rows }: { rows: Array<Record<string, unknown>> }) {
  const t = useT();
  if (!rows.length) {
    return <p className="text-sm text-[var(--color-ink-muted)]">{t('adminDashboard.emptySample')}</p>;
  }
  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const tenant = row.tenant as { slug?: string; name?: string } | undefined;
        return (
          <li key={String(row.id)} className="flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0">
              <Link
                href={`/admin/jobs/${row.id}`}
                className="break-all font-medium hover:underline"
              >
                {String(row.id)}
              </Link>
              <p className="truncate text-xs text-[var(--color-ink-muted)]">
                {tenant?.slug ?? String(row.tenantId)} · {String(row.checkType)} ·{' '}
                {String(row.status)}
              </p>
            </div>
            <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">
              {formatDate(String(row.updatedAt ?? row.createdAt))}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
