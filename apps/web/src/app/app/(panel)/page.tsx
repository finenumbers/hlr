'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { MetricCard } from '@/components/data/metric-card';
import { PageHeader } from '@/components/data/page-header';
import { QueryState } from '@/components/data/query-state';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api/client';
import { serviceLabel } from '@/lib/check-type';
import { useAuth } from '@/lib/auth/auth-context';
import { useT } from '@/lib/i18n';
import { formatDate, formatMoney } from '@/lib/utils';

type ProductQuote = {
  sellPrice?: string;
  currency?: string;
  code?: string;
} | null;

type UsageSlice = {
  jobs?: number;
  successCount?: number;
  failureCount?: number;
};

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
    products?: { hlr?: ProductQuote; ping?: ProductQuote };
    usage?: {
      hlr?: UsageSlice;
      ping?: UsageSlice;
    };
    recentJobs?: Array<Record<string, unknown>>;
  } | undefined;

  const currency = d?.balance?.currency ?? 'RUB';
  const productStatus = (quote: ProductQuote | undefined, unavailableKey: string) => {
    if (!quote) {
      return { text: t(unavailableKey), tone: 'warn' as const };
    }
    return {
      text: t('cabinetDashboard.productAvailable', {
        price: formatMoney(quote.sellPrice ?? '0', quote.currency ?? currency),
        code: quote.code ?? '',
      }),
      tone: 'ok' as const,
    };
  };
  const hlrStatus = productStatus(d?.products?.hlr, 'cabinetDashboard.hlrUnavailable');
  const pingStatus = productStatus(d?.products?.ping, 'cabinetDashboard.pingUnavailable');

  return (
    <div>
      <PageHeader
        title={t('cabinetDashboard.title')}
        description={t('cabinetDashboard.description')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/app/submit/hlr">
              <Button type="button" variant="secondary">
                {t('cabinetDashboard.openHlr')}
              </Button>
            </Link>
            <Link href="/app/submit/ping">
              <Button type="button">{t('cabinetDashboard.openPing')}</Button>
            </Link>
          </div>
        }
      />
      <QueryState
        isLoading={q.isLoading || !tenantId}
        isError={q.isError}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            label={t('cabinetDashboard.available')}
            value={formatMoney(d?.balance?.availableBalance ?? '0', currency)}
            hint={t('cabinetDashboard.held', {
              amount: formatMoney(d?.balance?.heldBalance ?? '0', currency),
            })}
            href="/app/billing"
          />
          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
              {t('common.serviceHlr')}
            </p>
            <p
              className={`mt-2 text-sm font-medium ${
                hlrStatus.tone === 'ok'
                  ? 'text-[var(--color-ok)]'
                  : 'text-[var(--color-warn)]'
              }`}
            >
              {hlrStatus.text}
            </p>
            <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
              {t('cabinetDashboard.usageHint', {
                jobs: d?.usage?.hlr?.jobs ?? 0,
                success: d?.usage?.hlr?.successCount ?? 0,
                failure: d?.usage?.hlr?.failureCount ?? 0,
              })}
            </p>
            <Link
              href="/app/jobs?checkType=HLR"
              className="mt-2 inline-block text-xs text-[var(--color-accent)]"
            >
              {t('cabinetDashboard.viewHlrJobs')}
            </Link>
          </Card>
          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
              {t('common.servicePing')}
            </p>
            <p
              className={`mt-2 text-sm font-medium ${
                pingStatus.tone === 'ok'
                  ? 'text-[var(--color-ok)]'
                  : 'text-[var(--color-warn)]'
              }`}
            >
              {pingStatus.text}
            </p>
            <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
              {t('cabinetDashboard.usageHint', {
                jobs: d?.usage?.ping?.jobs ?? 0,
                success: d?.usage?.ping?.successCount ?? 0,
                failure: d?.usage?.ping?.failureCount ?? 0,
              })}
            </p>
            <Link
              href="/app/jobs?checkType=PING"
              className="mt-2 inline-block text-xs text-[var(--color-accent)]"
            >
              {t('cabinetDashboard.viewPingJobs')}
            </Link>
          </Card>
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
                  {serviceLabel(String(job.checkType), t)} · {String(job.status)}
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
