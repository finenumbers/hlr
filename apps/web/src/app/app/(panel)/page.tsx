'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { MetricCard } from '@/components/data/metric-card';
import { QueryState } from '@/components/data/query-state';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api/client';
import { serviceLabel } from '@/lib/check-type';
import { useAuth } from '@/lib/auth/auth-context';
import { useT } from '@/lib/i18n';
import { labelJobStatus } from '@/lib/status-labels';
import { cn, formatDate, formatMoney } from '@/lib/utils';

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

function productCardClass(assigned: boolean): string {
  return cn(
    'h-full !text-black border-transparent',
    assigned ? 'bg-[var(--color-accent-bright)]' : 'bg-[#f97066]',
  );
}

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
      return t(unavailableKey);
    }
    return t('cabinetDashboard.productAvailable', {
      price: formatMoney(quote.sellPrice ?? '0', quote.currency ?? currency),
      code: quote.code ?? '',
    });
  };
  const hlrAssigned = Boolean(d?.products?.hlr);
  const pingAssigned = Boolean(d?.products?.ping);
  const hlrStatus = productStatus(d?.products?.hlr, 'cabinetDashboard.hlrUnavailable');
  const pingStatus = productStatus(d?.products?.ping, 'cabinetDashboard.pingUnavailable');

  return (
    <div>
      <QueryState
        isLoading={q.isLoading || !tenantId}
        isError={q.isError}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        <div className="grid items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            label={t('cabinetDashboard.available')}
            value={formatMoney(d?.balance?.availableBalance ?? '0', currency)}
            hint={t('cabinetDashboard.held', {
              amount: formatMoney(d?.balance?.heldBalance ?? '0', currency),
            })}
            href="/app/billing"
          />
          <Card className={productCardClass(hlrAssigned)}>
            <p className="text-xs font-bold !text-black">{t('cabinetSubmit.hlrTitle')}</p>
            <p className="mt-2 text-sm font-medium !text-black">{hlrStatus}</p>
            <p className="mt-3 text-xs !text-black">
              {t('cabinetDashboard.usageHint', {
                jobs: d?.usage?.hlr?.jobs ?? 0,
                success: d?.usage?.hlr?.successCount ?? 0,
                failure: d?.usage?.hlr?.failureCount ?? 0,
              })}
            </p>
            <Link
              href="/app/jobs?checkType=HLR"
              className="mt-2 inline-block text-xs font-medium !text-black underline-offset-2 hover:underline"
            >
              {t('cabinetDashboard.viewHlrJobs')}
            </Link>
          </Card>
          <Card className={productCardClass(pingAssigned)}>
            <p className="text-xs font-bold !text-black">{t('cabinetSubmit.pingTitle')}</p>
            <p className="mt-2 text-sm font-medium !text-black">{pingStatus}</p>
            <p className="mt-3 text-xs !text-black">
              {t('cabinetDashboard.usageHint', {
                jobs: d?.usage?.ping?.jobs ?? 0,
                success: d?.usage?.ping?.successCount ?? 0,
                failure: d?.usage?.ping?.failureCount ?? 0,
              })}
            </p>
            <Link
              href="/app/jobs?checkType=PING"
              className="mt-2 inline-block text-xs font-medium !text-black underline-offset-2 hover:underline"
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
                  {serviceLabel(String(job.checkType), t)} · {labelJobStatus(job.status, t)}
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
