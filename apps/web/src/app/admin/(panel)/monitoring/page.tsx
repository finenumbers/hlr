'use client';

import { useQuery } from '@tanstack/react-query';

import { MetricCard } from '@/components/data/metric-card';
import { PageHeader } from '@/components/data/page-header';
import { QueryState } from '@/components/data/query-state';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api/client';

export default function AdminMonitoringPage() {
  const q = useQuery({
    queryKey: ['admin', 'monitoring'],
    queryFn: () => api.admin.monitoring(),
  });
  const m = q.data as {
    provider?: { configured?: boolean; providerCode?: string; send?: string };
    providerRequests24h?: Record<string, number>;
    webhookDeliveries24h?: Record<string, number>;
    recentProviderRequests?: Array<Record<string, unknown>>;
  } | undefined;

  return (
    <div>
      <PageHeader
        title="Monitoring"
        description="Provider health, retry/failure counters, webhook delivery summary."
      />
      <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => void q.refetch()}>
        <div className="mb-4 flex flex-wrap gap-2">
          <Badge tone={m?.provider?.configured ? 'ok' : 'warn'}>
            {m?.provider?.providerCode ?? 'provider'} · {m?.provider?.send ?? 'unknown'}
          </Badge>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Provider failed 24h"
            value={m?.providerRequests24h?.FAILED ?? 0}
            tone={(m?.providerRequests24h?.FAILED ?? 0) > 0 ? 'danger' : 'ok'}
          />
          <MetricCard label="Provider ok 24h" value={m?.providerRequests24h?.SUCCEEDED ?? 0} tone="ok" />
          <MetricCard
            label="Webhook dead 24h"
            value={m?.webhookDeliveries24h?.DEAD ?? 0}
            tone={(m?.webhookDeliveries24h?.DEAD ?? 0) > 0 ? 'danger' : 'ok'}
          />
          <MetricCard label="Webhook failed 24h" value={m?.webhookDeliveries24h?.FAILED ?? 0} tone="warn" />
        </div>
        <Card className="mt-6">
          <h2 className="mb-3 font-semibold">Recent provider requests</h2>
          <ul className="space-y-2 text-sm">
            {(m?.recentProviderRequests ?? []).slice(0, 15).map((row) => (
              <li key={String(row.id)} className="flex justify-between gap-3 border-b border-[var(--color-line)] py-2">
                <span>
                  {String(row.kind ?? row.type ?? 'REQ')} · {String(row.status)}
                </span>
                <span className="text-[var(--color-ink-muted)]">{String(row.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </QueryState>
    </div>
  );
}
