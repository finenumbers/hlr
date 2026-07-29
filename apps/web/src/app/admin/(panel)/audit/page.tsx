'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';

import { DataTable } from '@/components/data/data-table';
import { PageHeader } from '@/components/data/page-header';
import { QueryState } from '@/components/data/query-state';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api/client';
import { formatDate } from '@/lib/utils';

function AdminAuditPage() {
  const search = useSearchParams();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState(search.get('action') ?? '');
  const [tenantId, setTenantId] = useState(search.get('tenantId') ?? '');
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (action) params.set('action', action);
    if (tenantId) params.set('tenantId', tenantId);
    return params.toString();
  }, [page, action, tenantId]);

  const q = useQuery({
    queryKey: ['admin', 'audit', queryString],
    queryFn: () => api.admin.audit(queryString),
  });

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Who did what, when, and to which target — especially money and admin mutations."
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Input
          placeholder="Action (e.g. billing.wallet.topup)"
          value={action}
          onChange={(e) => {
            setPage(1);
            setAction(e.target.value);
          }}
        />
        <Input
          placeholder="Tenant id"
          value={tenantId}
          onChange={(e) => {
            setPage(1);
            setTenantId(e.target.value);
          }}
        />
      </div>
      <QueryState
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        isEmpty={!q.data?.items.length}
        emptyTitle="No audit entries"
        onRetry={() => void q.refetch()}
      >
        <DataTable
          columns={[
            {
              key: 'when',
              header: 'When',
              cell: (row) => formatDate(String(row.createdAt)),
            },
            {
              key: 'actor',
              header: 'Actor',
              cell: (row) => {
                const actor = row.actor as { email?: string; type?: string; name?: string };
                return (
                  <div>
                    <p className="font-medium">{actor?.email ?? actor?.type ?? '—'}</p>
                    <p className="text-xs text-[var(--color-ink-muted)]">{actor?.type}</p>
                  </div>
                );
              },
            },
            { key: 'action', header: 'Action', cell: (row) => String(row.action) },
            {
              key: 'target',
              header: 'Target',
              cell: (row) => {
                const t = row.target as { type?: string; id?: string };
                return `${t?.type ?? '—'} ${t?.id ? String(t.id).slice(0, 10) + '…' : ''}`;
              },
            },
            {
              key: 'tenant',
              header: 'Tenant',
              cell: (row) => {
                const t = row.tenant as { slug?: string; name?: string } | null;
                return t?.slug ?? '—';
              },
            },
            {
              key: 'meta',
              header: 'Summary',
              cell: (row) => {
                const meta = row.metadata as Record<string, unknown> | null;
                if (!meta) return '—';
                if (meta.amount != null) {
                  return `${meta.direction ? String(meta.direction) + ' ' : ''}${String(meta.amount)} ${meta.currency ?? ''}`.trim();
                }
                return (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(row)}>
                    Details
                  </Button>
                );
              },
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

      <Dialog
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="Audit entry"
        className="max-w-2xl"
      >
        <pre className="max-h-96 overflow-auto rounded-md bg-[var(--color-panel)] p-3 text-xs">
          {JSON.stringify(selected, null, 2)}
        </pre>
      </Dialog>
    </div>
  );
}


export default function Page() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-[var(--color-ink-muted)]">Loading…</div>}>
      <AdminAuditPage />
    </Suspense>
  );
}
