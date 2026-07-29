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
import { formatDate, formatMoney } from '@/lib/utils';

export default function CabinetDashboardPage() {
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
        title="Dashboard"
        description="Balance, recent jobs, and usage — no chart noise."
        actions={
          <Link href="/app/submit">
            <Button type="button">Submit check</Button>
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
            label="Available balance"
            value={formatMoney(d?.balance?.availableBalance ?? '0', d?.balance?.currency ?? 'RUB')}
            hint={`Held ${formatMoney(d?.balance?.heldBalance ?? '0', d?.balance?.currency ?? 'RUB')}`}
            href="/app/billing"
          />
          <MetricCard label="Jobs (30d)" value={d?.usage?.jobs ?? 0} href="/app/jobs" />
          <MetricCard
            label="HLR / Ping"
            value={`${d?.usage?.hlrCount ?? 0} / ${d?.usage?.pingCount ?? 0}`}
          />
          <MetricCard
            label="Success / failure"
            value={`${d?.usage?.successCount ?? 0} / ${d?.usage?.failureCount ?? 0}`}
            tone={(d?.usage?.failureCount ?? 0) > 0 ? 'warn' : 'ok'}
          />
        </div>
        <Card className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Recent jobs</h2>
            <Link href="/app/jobs" className="text-xs text-[var(--color-accent)]">
              View all
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
              <li className="text-sm text-[var(--color-ink-muted)]">No jobs yet.</li>
            ) : null}
          </ul>
        </Card>
      </QueryState>
    </div>
  );
}
