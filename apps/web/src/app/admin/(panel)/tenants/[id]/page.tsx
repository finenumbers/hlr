'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { Can } from '@/components/auth/require-permission';
import { PageHeader } from '@/components/data/page-header';
import { QueryState } from '@/components/data/query-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api/client';
import { formatMoney } from '@/lib/utils';

export default function AdminTenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [status, setStatus] = useState<string | null>(null);
  const [tariffPlanId, setTariffPlanId] = useState('');
  const [topupAmount, setTopupAmount] = useState('100');
  const [confirmTopup, setConfirmTopup] = useState(false);

  const q = useQuery({
    queryKey: ['admin', 'tenant', id],
    queryFn: () => api.admin.tenant(id),
  });
  const tariffs = useQuery({
    queryKey: ['admin', 'tariffs'],
    queryFn: () => api.admin.tariffs(),
  });

  const statusMut = useMutation({
    mutationFn: (next: string) => api.admin.updateTenantStatus(id, next),
    onSuccess: async () => {
      setStatus(null);
      await qc.invalidateQueries({ queryKey: ['admin', 'tenant', id] });
    },
  });
  const tariffMut = useMutation({
    mutationFn: () => api.admin.assignTariff(id, { tariffPlanId }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'tenant', id] });
    },
  });
  const topupMut = useMutation({
    mutationFn: () =>
      api.admin.topup({
        tenantId: id,
        amount: topupAmount,
        idempotencyKey: `ui-topup-${id}-${Date.now()}`,
      }),
    onSuccess: async () => {
      setConfirmTopup(false);
      await qc.invalidateQueries({ queryKey: ['admin', 'tenant', id] });
    },
  });

  const t = q.data;

  return (
    <div>
      <PageHeader
        title={String(t?.name ?? 'Tenant')}
        description={String(t?.slug ?? id)}
        actions={
          <Link href={`/admin/audit?tenantId=${id}`}>
            <Button type="button" variant="secondary" size="sm">
              View audit
            </Button>
          </Link>
        }
      />
      <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => void q.refetch()}>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <h2 className="font-semibold">Status</h2>
            <div className="mt-2">
              <Badge tone={t?.status === 'ACTIVE' ? 'ok' : 'warn'}>{String(t?.status)}</Badge>
            </div>
            <Can permission="admin.tenants.write">
              <div className="mt-4 flex gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => setStatus('SUSPENDED')}>
                  Suspend
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setStatus('ACTIVE')}>
                  Activate
                </Button>
              </div>
            </Can>
          </Card>
          <Card>
            <h2 className="font-semibold">Wallet</h2>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {formatMoney(
                String((t?.wallet as { availableBalance?: string } | null)?.availableBalance ?? '0'),
                String((t?.wallet as { currency?: string } | null)?.currency ?? 'RUB'),
              )}
            </p>
            <p className="text-xs text-[var(--color-ink-muted)]">
              Held:{' '}
              {formatMoney(
                String((t?.wallet as { heldBalance?: string } | null)?.heldBalance ?? '0'),
                String((t?.wallet as { currency?: string } | null)?.currency ?? 'RUB'),
              )}
            </p>
            <Can permission="admin.billing.mutate">
              <div className="mt-4 space-y-2">
                <Label>Top-up amount</Label>
                <Input value={topupAmount} onChange={(e) => setTopupAmount(e.target.value)} />
                <Button type="button" size="sm" onClick={() => setConfirmTopup(true)}>
                  Top up
                </Button>
              </div>
            </Can>
          </Card>
          <Card>
            <h2 className="font-semibold">Tariff</h2>
            <p className="mt-2 text-sm">
              {(t?.tariff as { code?: string; name?: string } | null)?.code ?? 'Not assigned'} —{' '}
              {(t?.tariff as { name?: string } | null)?.name ?? ''}
            </p>
            <Can permission="admin.tenants.write">
              <div className="mt-4 space-y-2">
                <Label>Assign tariff plan</Label>
                <select
                  className="h-10 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-panel-elevated)] px-2 text-sm"
                  value={tariffPlanId}
                  onChange={(e) => setTariffPlanId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {(tariffs.data?.items ?? []).map((plan) => (
                    <option key={String(plan.id)} value={String(plan.id)}>
                      {String(plan.code)} — {String(plan.name)}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  size="sm"
                  disabled={!tariffPlanId || tariffMut.isPending}
                  onClick={() => tariffMut.mutate()}
                >
                  Assign
                </Button>
              </div>
            </Can>
          </Card>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Card>
            <p className="text-xs uppercase text-[var(--color-ink-muted)]">API keys</p>
            <p className="mt-1 text-2xl font-semibold">
              {String((t?.counts as { apiKeys?: number } | undefined)?.apiKeys ?? 0)}
            </p>
          </Card>
          <Card>
            <p className="text-xs uppercase text-[var(--color-ink-muted)]">Webhooks</p>
            <p className="mt-1 text-2xl font-semibold">
              {String((t?.counts as { webhookEndpoints?: number } | undefined)?.webhookEndpoints ?? 0)}
            </p>
          </Card>
          <Card>
            <p className="text-xs uppercase text-[var(--color-ink-muted)]">Jobs</p>
            <p className="mt-1 text-2xl font-semibold">
              {String((t?.counts as { jobs?: number } | undefined)?.jobs ?? 0)}
            </p>
            <Link href={`/admin/jobs?tenantId=${id}`} className="mt-2 inline-block text-xs text-[var(--color-accent)]">
              Open jobs
            </Link>
          </Card>
        </div>
      </QueryState>

      <ConfirmDialog
        open={Boolean(status)}
        onClose={() => setStatus(null)}
        title="Change tenant status"
        description={`Set status to ${status}? This is audited.`}
        confirmLabel="Update"
        loading={statusMut.isPending}
        onConfirm={() => status && statusMut.mutate(status)}
      />
      <ConfirmDialog
        open={confirmTopup}
        onClose={() => setConfirmTopup(false)}
        title="Confirm top-up"
        description={`Credit ${topupAmount} to this tenant wallet?`}
        confirmLabel="Top up"
        loading={topupMut.isPending}
        onConfirm={() => topupMut.mutate()}
      />
    </div>
  );
}
