'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { Can } from '@/components/auth/require-permission';
import { PageHeader } from '@/components/data/page-header';
import { QueryState } from '@/components/data/query-state';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api/client';
import { formatMoney } from '@/lib/utils';

export default function AdminBillingPage() {
  const [tenantId, setTenantId] = useState('');
  const [amount, setAmount] = useState('100');
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [confirm, setConfirm] = useState<'topup' | 'adjust' | null>(null);

  const wallet = useQuery({
    queryKey: ['admin', 'wallet', tenantId],
    queryFn: () => api.admin.wallet(tenantId),
    enabled: Boolean(tenantId),
  });
  const ledger = useQuery({
    queryKey: ['admin', 'ledger', tenantId],
    queryFn: () => api.admin.ledger(tenantId),
    enabled: Boolean(tenantId),
  });

  const topup = useMutation({
    mutationFn: () =>
      api.admin.topup({
        tenantId,
        amount,
        idempotencyKey: `ui-topup-${tenantId}-${Date.now()}`,
      }),
    onSuccess: async () => {
      setConfirm(null);
      await wallet.refetch();
      await ledger.refetch();
    },
  });
  const adjust = useMutation({
    mutationFn: () =>
      api.admin.adjust({
        tenantId,
        amount,
        direction,
        idempotencyKey: `ui-adj-${tenantId}-${Date.now()}`,
      }),
    onSuccess: async () => {
      setConfirm(null);
      await wallet.refetch();
      await ledger.refetch();
    },
  });

  return (
    <div>
      <PageHeader
        title="Billing ops"
        description="Wallet overview, manual top-up and adjustments. All money actions are audited."
      />
      <Card className="mb-4 max-w-xl space-y-3">
        <div>
          <Label>Tenant id</Label>
          <Input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="cuid…" />
        </div>
        <Can permission="admin.billing.mutate">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Amount</Label>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <Label>Adjust direction</Label>
              <select
                className="h-10 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-panel-elevated)] px-2 text-sm"
                value={direction}
                onChange={(e) => setDirection(e.target.value as 'credit' | 'debit')}
              >
                <option value="credit">credit</option>
                <option value="debit">debit</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="button" disabled={!tenantId} onClick={() => setConfirm('topup')}>
              Top up
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!tenantId}
              onClick={() => setConfirm('adjust')}
            >
              Adjust
            </Button>
          </div>
        </Can>
      </Card>

      <QueryState
        isLoading={Boolean(tenantId) && wallet.isLoading}
        isError={wallet.isError}
        error={wallet.error}
        isEmpty={!tenantId}
        emptyTitle="Enter a tenant id"
        emptyDescription="Load wallet and ledger for billing operations."
      >
        {wallet.data ? (
          <div className="space-y-4">
            <Card>
              <p className="text-sm text-[var(--color-ink-muted)]">Available</p>
              <p className="text-3xl font-semibold">
                {formatMoney(String(wallet.data.availableBalance), String(wallet.data.currency))}
              </p>
              <p className="text-sm text-[var(--color-ink-muted)]">
                Held {formatMoney(String(wallet.data.heldBalance), String(wallet.data.currency))}
              </p>
              <Link
                href={`/admin/tenants/${tenantId}`}
                className="mt-2 inline-block text-xs text-[var(--color-accent)]"
              >
                Open tenant
              </Link>
            </Card>
            <Card>
              <h2 className="mb-3 font-semibold">Recent ledger</h2>
              <ul className="space-y-2 text-sm">
                {((ledger.data as Array<Record<string, unknown>> | undefined) ?? [])
                  .slice()
                  .reverse()
                  .slice(0, 20)
                  .map((row) => (
                    <li key={String(row.id)} className="flex justify-between gap-3 border-b border-[var(--color-line)] py-2">
                      <span>
                        {String(row.type)} · {String(row.amount)}
                      </span>
                      <span className="text-[var(--color-ink-muted)]">{String(row.createdAt)}</span>
                    </li>
                  ))}
              </ul>
            </Card>
          </div>
        ) : null}
      </QueryState>

      <ConfirmDialog
        open={confirm === 'topup'}
        onClose={() => setConfirm(null)}
        title="Confirm top-up"
        description={`Credit ${amount} to tenant ${tenantId}?`}
        loading={topup.isPending}
        onConfirm={() => topup.mutate()}
      />
      <ConfirmDialog
        open={confirm === 'adjust'}
        onClose={() => setConfirm(null)}
        title="Confirm adjustment"
        description={`${direction} ${amount} on tenant ${tenantId}?`}
        danger={direction === 'debit'}
        loading={adjust.isPending}
        onConfirm={() => adjust.mutate()}
      />
    </div>
  );
}
