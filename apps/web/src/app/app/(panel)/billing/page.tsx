'use client';

import { useQuery } from '@tanstack/react-query';

import { PageHeader } from '@/components/data/page-header';
import { QueryState } from '@/components/data/query-state';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-context';
import {
  formatCabinetLedgerDescription,
  formatCabinetLedgerType,
} from '@/lib/billing/ledger-labels';
import { useI18n, useT } from '@/lib/i18n';
import { formatDate, formatMoney } from '@/lib/utils';

export default function CabinetBillingPage() {
  const t = useT();
  const { locale } = useI18n();
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
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });

  return (
    <div>
      <PageHeader title={t('cabinetBilling.title')} description={t('cabinetBilling.description')} />
      <QueryState isLoading={balance.isLoading} isError={balance.isError} error={balance.error}>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <p className="text-xs font-bold text-[var(--color-ink-muted)]">{t('cabinetBilling.available')}</p>
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
            <p className="text-xs font-bold text-[var(--color-ink-muted)]">{t('cabinetBilling.tariff')}</p>
            <div className="mt-2 space-y-2 text-sm">
              <div>
                <p className="font-medium">{t('cabinetBilling.hlrTitle')}</p>
                {tariff.data?.hlr ? (
                  <p>
                    {tariff.data.hlr.code} —{' '}
                    {t('cabinetBilling.price', {
                      amount: formatMoney(
                        tariff.data.hlr.sellPrice,
                        tariff.data.hlr.currency,
                      ),
                    })}
                  </p>
                ) : (
                  <p className="text-[var(--color-ink-muted)]">{t('cabinetBilling.hlrNotAssigned')}</p>
                )}
              </div>
              <div>
                <p className="font-medium">{t('cabinetBilling.pingTitle')}</p>
                {tariff.data?.ping ? (
                  <p>
                    {tariff.data.ping.code} —{' '}
                    {t('cabinetBilling.price', {
                      amount: formatMoney(
                        tariff.data.ping.sellPrice,
                        tariff.data.ping.currency,
                      ),
                    })}
                  </p>
                ) : (
                  <p className="text-[var(--color-ink-muted)]">{t('cabinetBilling.pingNotAssigned')}</p>
                )}
              </div>
            </div>
          </Card>
        </div>
        <Card className="mt-4">
          <h2 className="mb-3 font-semibold">{t('cabinetBilling.transactions')}</h2>
          <ul className="space-y-2 text-sm">
            {((ledger.data as Array<Record<string, unknown>> | undefined) ?? [])
              .slice()
              .reverse()
              .slice(0, 50)
              .map((row) => {
                const typeLabel = formatCabinetLedgerType(t, String(row.type ?? ''));
                const description = formatCabinetLedgerDescription(
                  t,
                  row.description == null ? null : String(row.description),
                );
                const amount = formatMoney(
                  String(row.amount ?? '0'),
                  String(row.currency ?? balance.data?.currency ?? 'RUB'),
                );
                return (
                  <li
                    key={String(row.id)}
                    className="flex justify-between gap-3 border-b border-[var(--color-line)] py-2"
                  >
                    <span className="min-w-0">
                      <span className="font-medium">
                        {typeLabel} · {amount}
                      </span>
                      {description ? (
                        <span className="mt-0.5 block text-xs text-[var(--color-ink-muted)]">
                          {description}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-[var(--color-ink-muted)]">
                      {formatDate(String(row.createdAt ?? ''), locale)}
                    </span>
                  </li>
                );
              })}
            {!ledger.data?.length ? (
              <li className="text-[var(--color-ink-muted)]">{t('cabinetBilling.noTransactions')}</li>
            ) : null}
          </ul>
        </Card>
      </QueryState>
    </div>
  );
}
