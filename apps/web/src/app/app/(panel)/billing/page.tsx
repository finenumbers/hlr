'use client';

import { useQuery } from '@tanstack/react-query';

import { PageHeader } from '@/components/data/page-header';
import { QueryState } from '@/components/data/query-state';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-context';
import { useT } from '@/lib/i18n';
import { formatMoney } from '@/lib/utils';

export default function CabinetBillingPage() {
  const t = useT();
  const { tenantId } = useAuth();
  const balance = useQuery({
    queryKey: ['cabinet', 'balance', tenantId],
    queryFn: () => api.cabinet.balance(),
    enabled: Boolean(tenantId),
  });
  const ledger = useQuery({
    queryKey: ['cabinet', 'ledger', tenantId],
    queryFn: () => api.cabinet.ledger(),
    enabled: Boolean(tenantId),
  });
  const tariff = useQuery({
    queryKey: ['cabinet', 'tariff', tenantId],
    queryFn: () => api.cabinet.tariff(),
    enabled: Boolean(tenantId),
  });

  return (
    <div>
      <PageHeader title={t('cabinetBilling.title')} description={t('cabinetBilling.description')} />
      <QueryState isLoading={balance.isLoading} isError={balance.isError} error={balance.error}>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <p className="text-xs uppercase text-[var(--color-ink-muted)]">{t('cabinetBilling.available')}</p>
            <p className="mt-2 text-3xl font-semibold">
              {formatMoney(String(balance.data?.availableBalance ?? '0'), String(balance.data?.currency ?? 'RUB'))}
            </p>
            <p className="text-sm text-[var(--color-ink-muted)]">
              {t('cabinetBilling.held', {
                amount: formatMoney(
                  String(balance.data?.heldBalance ?? '0'),
                  String(balance.data?.currency ?? 'RUB'),
                ),
              })}
            </p>
          </Card>
          <Card>
            <p className="text-xs uppercase text-[var(--color-ink-muted)]">{t('cabinetBilling.tariff')}</p>
            {tariff.data ? (
              <div className="mt-2 space-y-1 text-sm">
                <p className="font-medium">
                  {String(tariff.data.code)} — {String(tariff.data.name)}
                </p>
                <p>
                  {t('cabinetBilling.hlrPrice', {
                    amount: formatMoney(String(tariff.data.hlrPrice), String(tariff.data.currency ?? 'RUB')),
                  })}
                </p>
                <p>
                  {t('cabinetBilling.pingPrice', {
                    amount: formatMoney(String(tariff.data.pingPrice), String(tariff.data.currency ?? 'RUB')),
                  })}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-[var(--color-ink-muted)]">{t('cabinetBilling.noTariff')}</p>
            )}
          </Card>
        </div>
        <Card className="mt-4">
          <h2 className="mb-3 font-semibold">{t('cabinetBilling.transactions')}</h2>
          <ul className="space-y-2 text-sm">
            {((ledger.data as Array<Record<string, unknown>> | undefined) ?? [])
              .slice()
              .reverse()
              .slice(0, 50)
              .map((row) => (
                <li key={String(row.id)} className="flex justify-between gap-3 border-b border-[var(--color-line)] py-2">
                  <span>
                    {String(row.type)} · {String(row.amount)}
                  </span>
                  <span className="text-[var(--color-ink-muted)]">{String(row.createdAt)}</span>
                </li>
              ))}
            {!ledger.data?.length ? (
              <li className="text-[var(--color-ink-muted)]">{t('cabinetBilling.noTransactions')}</li>
            ) : null}
          </ul>
        </Card>
      </QueryState>
    </div>
  );
}
