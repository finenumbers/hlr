'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { DataTable } from '@/components/data/data-table';
import { PageHeader } from '@/components/data/page-header';
import { QueryState } from '@/components/data/query-state';
import { api } from '@/lib/api/client';
import { formatLedgerDescription, formatLedgerType } from '@/lib/billing/ledger-labels';
import { useT } from '@/lib/i18n';
import { formatDate, formatMoney } from '@/lib/utils';

export default function AdminBillingPage() {
  const t = useT();
  const [page, setPage] = useState(1);
  const [tenantFilter, setTenantFilter] = useState('');
  const pageSize = 25;

  const tenants = useQuery({
    queryKey: ['admin', 'tenants', 'billing-filter'],
    queryFn: () => api.admin.tenants('page=1&pageSize=100&status=ACTIVE'),
  });

  const ledgerQuery = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (tenantFilter) params.set('tenantId', tenantFilter);
    return params.toString();
  }, [page, tenantFilter]);

  const ledger = useQuery({
    queryKey: ['admin', 'platform-ledger', ledgerQuery],
    queryFn: () => api.admin.platformLedger(ledgerQuery),
  });

  return (
    <div>
      <PageHeader title={t('adminBilling.title')} description={t('adminBilling.description')} />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-sm text-[var(--color-ink-muted)]" htmlFor="billing-tenant">
            {t('adminBilling.filterTenant')}
          </label>
          <select
            id="billing-tenant"
            className="h-10 min-w-[16rem] rounded-md border border-[var(--color-line)] bg-[var(--color-panel-elevated)] px-2 text-sm"
            value={tenantFilter}
            onChange={(e) => {
              setTenantFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('adminBilling.filterAllTenants')}</option>
            {((tenants.data?.items ?? []) as Array<Record<string, unknown>>).map((row) => (
              <option key={String(row.id)} value={String(row.id)}>
                {String(row.name)} ({String(row.slug)})
              </option>
            ))}
          </select>
        </div>
        <p className="pb-2 text-xs text-[var(--color-ink-muted)]">{t('adminBilling.topupHint')}</p>
      </div>

      <QueryState
        isLoading={ledger.isLoading}
        isError={ledger.isError}
        error={ledger.error}
        isEmpty={!ledger.data?.items.length}
        emptyTitle={t('adminBilling.emptyTitle')}
        emptyDescription={t('adminBilling.emptyDescription')}
        onRetry={() => void ledger.refetch()}
      >
        <DataTable
          columns={[
            {
              key: 'createdAt',
              header: t('adminBilling.colWhen'),
              cell: (row) => formatDate(String(row.createdAt)),
            },
            {
              key: 'tenant',
              header: t('adminBilling.colTenant'),
              cell: (row) => (
                <Link
                  href={`/admin/tenants/${String(row.tenantId)}`}
                  className="font-medium hover:underline"
                >
                  {String(row.tenantName ?? row.tenantId)}
                </Link>
              ),
            },
            {
              key: 'type',
              header: t('adminBilling.colType'),
              cell: (row) =>
                row.type == null
                  ? t('common.dash')
                  : formatLedgerType(t, String(row.type)),
            },
            {
              key: 'amount',
              header: t('adminBilling.colAmount'),
              cell: (row) =>
                formatMoney(String(row.amount ?? '0'), String(row.currency ?? 'RUB')),
            },
            {
              key: 'balance',
              header: t('adminBilling.colBalance'),
              cell: (row) =>
                row.balanceAfterAvailable == null
                  ? t('common.dash')
                  : formatMoney(
                      String(row.balanceAfterAvailable),
                      String(row.currency ?? 'RUB'),
                    ),
            },
            {
              key: 'description',
              header: t('adminBilling.colDesc'),
              cell: (row) =>
                formatLedgerDescription(
                  t,
                  row.description == null ? null : String(row.description),
                ) ?? t('common.dash'),
            },
          ]}
          rows={(ledger.data?.items ?? []) as Array<Record<string, unknown>>}
          rowKey={(row) => String(row.id)}
          page={page}
          pageSize={pageSize}
          total={ledger.data?.total ?? 0}
          onPageChange={setPage}
        />
      </QueryState>
    </div>
  );
}
