'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { DataTable } from '@/components/data/data-table';
import { PageHeader } from '@/components/data/page-header';
import { QueryState } from '@/components/data/query-state';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api/client';
import { formatDate, formatMoney } from '@/lib/utils';

function AdminTenantsPage() {
  const search = useSearchParams();
  const [page, setPage] = useState(1);
  const status = search.get('status') ?? '';
  const q = useQuery({
    queryKey: ['admin', 'tenants', page, status],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (status) params.set('status', status);
      return api.admin.tenants(params.toString());
    },
  });

  return (
    <div>
      <PageHeader title="Tenants" description="Status, tariff, balance, and integration summary." />
      <QueryState
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        isEmpty={!q.data?.items.length}
        emptyTitle="No tenants"
        onRetry={() => void q.refetch()}
      >
        <DataTable
          columns={[
            {
              key: 'name',
              header: 'Tenant',
              cell: (row) => (
                <div>
                  <Link href={`/admin/tenants/${row.id}`} className="font-medium hover:underline">
                    {String(row.name)}
                  </Link>
                  <p className="text-xs text-[var(--color-ink-muted)]">{String(row.slug)}</p>
                </div>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              cell: (row) => (
                <Badge
                  tone={
                    row.status === 'ACTIVE' ? 'ok' : row.status === 'SUSPENDED' ? 'warn' : 'neutral'
                  }
                >
                  {String(row.status)}
                </Badge>
              ),
            },
            {
              key: 'balance',
              header: 'Available',
              cell: (row) => {
                const w = row.wallet as { availableBalance?: string; currency?: string } | null;
                return w ? formatMoney(w.availableBalance ?? '0', w.currency) : '—';
              },
            },
            {
              key: 'tariff',
              header: 'Tariff',
              cell: (row) => {
                const t = row.tariff as { code?: string } | null;
                return t?.code ?? '—';
              },
            },
            {
              key: 'created',
              header: 'Created',
              cell: (row) => formatDate(String(row.createdAt)),
            },
          ]}
          rows={(q.data?.items ?? []) as Array<Record<string, unknown>>}
          rowKey={(row) => String(row.id)}
          page={page}
          pageSize={20}
          total={q.data?.total ?? 0}
          onPageChange={setPage}
        />
      </QueryState>
    </div>
  );
}


export default function Page() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-[var(--color-ink-muted)]">Loading…</div>}>
      <AdminTenantsPage />
    </Suspense>
  );
}
