'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { MetricCard } from '@/components/data/metric-card';
import { PageHeader } from '@/components/data/page-header';
import { QueryState } from '@/components/data/query-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api/client';
import { useT } from '@/lib/i18n';
import { formatMoney } from '@/lib/utils';

export default function AdminMonitoringPage() {
  const t = useT();
  const [checkType, setCheckType] = useState<'HLR' | 'PING'>('HLR');
  const [phone, setPhone] = useState('+79991234567');
  const [costError, setCostError] = useState<string | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

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

  const costMut = useMutation({
    mutationFn: () => api.admin.estimateSmscCost({ checkType, phone }),
    onMutate: () => setCostError(null),
    onError: (err) => {
      setCostError(err instanceof ApiError ? err.message : t('adminMonitoring.requestFailed'));
    },
  });

  const balanceMut = useMutation({
    mutationFn: () => api.admin.smscBalance(),
    onMutate: () => setBalanceError(null),
    onError: (err) => {
      setBalanceError(err instanceof ApiError ? err.message : t('adminMonitoring.requestFailed'));
    },
  });

  const configured = Boolean(m?.provider?.configured);

  return (
    <div>
      <PageHeader title={t('adminMonitoring.title')} description={t('adminMonitoring.description')} />
      <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => void q.refetch()}>
        <div className="mb-4 flex flex-wrap gap-2">
          <Badge tone={configured ? 'ok' : 'warn'}>
            {m?.provider?.providerCode ?? 'provider'} · {m?.provider?.send ?? 'unknown'}
          </Badge>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label={t('adminMonitoring.providerFailed')}
            value={m?.providerRequests24h?.FAILED ?? 0}
            tone={(m?.providerRequests24h?.FAILED ?? 0) > 0 ? 'danger' : 'ok'}
          />
          <MetricCard
            label={t('adminMonitoring.providerOk')}
            value={m?.providerRequests24h?.SUCCEEDED ?? 0}
            tone="ok"
          />
          <MetricCard
            label={t('adminMonitoring.webhookDead')}
            value={m?.webhookDeliveries24h?.DEAD ?? 0}
            tone={(m?.webhookDeliveries24h?.DEAD ?? 0) > 0 ? 'danger' : 'ok'}
          />
          <MetricCard
            label={t('adminMonitoring.webhookFailed')}
            value={m?.webhookDeliveries24h?.FAILED ?? 0}
            tone="warn"
          />
        </div>

        <Card className="mt-6 space-y-4">
          <div>
            <h2 className="font-semibold">{t('adminMonitoring.smscTools')}</h2>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
              {t('adminMonitoring.smscToolsHint')}
            </p>
            {!configured ? (
              <p className="mt-2 text-sm text-[var(--color-danger)]">
                {t('adminMonitoring.notConfigured')}
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="smsc-check-type">{t('adminMonitoring.checkType')}</Label>
                <select
                  id="smsc-check-type"
                  className="h-10 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-panel-elevated)] px-2 text-sm"
                  value={checkType}
                  onChange={(e) => setCheckType(e.target.value as 'HLR' | 'PING')}
                  disabled={!configured}
                >
                  <option value="HLR">HLR</option>
                  <option value="PING">Silent SMS</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="smsc-phone">{t('adminMonitoring.phone')}</Label>
                <Input
                  id="smsc-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t('adminMonitoring.phonePlaceholder')}
                  disabled={!configured}
                />
              </div>
              <Button
                type="button"
                size="sm"
                disabled={!configured || !phone.trim() || costMut.isPending}
                onClick={() => costMut.mutate()}
              >
                {costMut.isPending ? t('adminMonitoring.requesting') : t('adminMonitoring.requestCost')}
              </Button>
              {costError ? (
                <p className="text-sm text-[var(--color-danger)]">{costError}</p>
              ) : null}
              {costMut.data ? (
                <p className="text-sm">
                  {t('adminMonitoring.costResult', {
                    cost: formatMoney(costMut.data.cost, costMut.data.currency ?? 'RUB'),
                    phone: costMut.data.phoneE164,
                  })}
                  {costMut.data.parts != null
                    ? ` · ${t('adminMonitoring.costParts', { parts: costMut.data.parts })}`
                    : null}
                </p>
              ) : null}
            </div>

            <div className="space-y-3">
              <div>
                <Label>{t('adminMonitoring.balance')}</Label>
                <p className="mt-2 text-2xl font-semibold tabular-nums">
                  {balanceMut.data
                    ? t('adminMonitoring.balanceValue', {
                        amount: formatMoney(
                          balanceMut.data.balance,
                          balanceMut.data.currency ?? 'RUB',
                        ),
                      })
                    : t('common.dash')}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!configured || balanceMut.isPending}
                onClick={() => balanceMut.mutate()}
              >
                {balanceMut.isPending
                  ? t('adminMonitoring.requesting')
                  : t('adminMonitoring.refreshBalance')}
              </Button>
              {balanceError ? (
                <p className="text-sm text-[var(--color-danger)]">{balanceError}</p>
              ) : null}
            </div>
          </div>
        </Card>

        <Card className="mt-6">
          <h2 className="mb-3 font-semibold">{t('adminMonitoring.recentRequests')}</h2>
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
