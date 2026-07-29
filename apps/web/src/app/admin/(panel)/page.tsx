'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { MetricCard } from '@/components/data/metric-card';
import { PageHeader } from '@/components/data/page-header';
import { QueryState } from '@/components/data/query-state';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api/client';
import { formatDate, formatMoney } from '@/lib/utils';

export default function AdminDashboardPage() {
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
      jobs24h?: number;
      hlrItems24h?: number;
      pingItems24h?: number;
    };
    money?: { capturedDebit24h?: string; currency?: string };
    problems?: {
      providerErrorRatePct?: number;
      stuckJobs?: Array<Record<string, unknown>>;
      failedJobs?: Array<Record<string, unknown>>;
    };
  } | undefined;

  return (
    <div>
      <PageHeader
        title="Operations"
        description="Is the platform healthy, who is stuck, where are errors, and where is money — last 24h."
      />
      <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => void q.refetch()}>
        <div className="mb-4 flex flex-wrap gap-2">
          <Badge tone={d?.health?.providerConfigured ? 'ok' : 'warn'}>
            Provider {d?.health?.providerConfigured ? 'ready' : 'unconfigured'}
          </Badge>
          <Badge tone={(d?.health?.stuckJobs ?? 0) > 0 ? 'warn' : 'ok'}>
            Stuck jobs: {d?.health?.stuckJobs ?? 0}
          </Badge>
          <Badge tone={(d?.health?.webhookDeadLetter24h ?? 0) > 0 ? 'danger' : 'ok'}>
            Dead webhooks 24h: {d?.health?.webhookDeadLetter24h ?? 0}
          </Badge>
          <Badge
            tone={(d?.problems?.providerErrorRatePct ?? 0) > 5 ? 'danger' : 'neutral'}
          >
            Provider errors: {d?.problems?.providerErrorRatePct ?? 0}%
          </Badge>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Active tenants"
            value={d?.volume?.tenantsActive ?? 0}
            hint={`${d?.volume?.tenantsTotal ?? 0} total · ${d?.volume?.tenantsSuspended ?? 0} suspended`}
            href="/admin/tenants?status=ACTIVE"
          />
          <MetricCard
            label="Jobs 24h"
            value={d?.volume?.jobs24h ?? 0}
            hint={`HLR ${d?.volume?.hlrItems24h ?? 0} · Ping ${d?.volume?.pingItems24h ?? 0}`}
            href="/admin/jobs"
          />
          <MetricCard
            label="Captured debit 24h"
            value={formatMoney(d?.money?.capturedDebit24h ?? '0', d?.money?.currency ?? 'RUB')}
            hint="Ledger DEBIT sum"
            href="/admin/audit?action=billing.wallet."
          />
          <MetricCard
            label="Failed / errored jobs"
            value={(d?.problems?.failedJobs ?? []).length}
            hint="Recent sample — open Jobs for full list"
            href="/admin/jobs?status=FAILED"
            tone={(d?.problems?.failedJobs ?? []).length ? 'danger' : 'ok'}
          />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Stuck jobs</h2>
              <Link href="/admin/jobs?status=PROCESSING" className="text-xs text-[var(--color-accent)]">
                View all
              </Link>
            </div>
            <ProblemList rows={d?.problems?.stuckJobs ?? []} />
          </Card>
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Failed jobs (24h)</h2>
              <Link href="/admin/jobs?status=FAILED" className="text-xs text-[var(--color-accent)]">
                View all
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
  if (!rows.length) {
    return <p className="text-sm text-[var(--color-ink-muted)]">No issues in this sample.</p>;
  }
  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const tenant = row.tenant as { slug?: string; name?: string } | undefined;
        return (
          <li key={String(row.id)} className="flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0">
              <Link href={`/admin/jobs/${row.id}`} className="font-medium hover:underline">
                {String(row.id).slice(0, 10)}…
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
