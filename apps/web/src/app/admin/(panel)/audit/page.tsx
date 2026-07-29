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
import { useT } from '@/lib/i18n';
import { formatDate } from '@/lib/utils';

function LoadingFallback() {
  const t = useT();
  return <div className="p-8 text-sm text-[var(--color-ink-muted)]">{t('common.loading')}</div>;
}

function AdminAuditPage() {
  const t = useT();
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
      <PageHeader title={t('adminAudit.title')} description={t('adminAudit.description')} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Input
          placeholder={t('adminAudit.filterAction')}
          value={action}
          onChange={(e) => {
            setPage(1);
            setAction(e.target.value);
          }}
        />
        <Input
          placeholder={t('adminAudit.filterTenantId')}
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
        emptyTitle={t('adminAudit.empty')}
        onRetry={() => void q.refetch()}
      >
        <DataTable
          columns={[
            {
              key: 'when',
              header: t('adminAudit.colWhen'),
              cell: (row) => formatDate(String(row.createdAt)),
            },
            {
              key: 'actor',
              header: t('adminAudit.colActor'),
              cell: (row) => {
                const actor = row.actor as { email?: string; type?: string; name?: string };
                return (
                  <div>
                    <p className="font-medium">{actor?.email ?? actor?.type ?? t('common.dash')}</p>
                    <p className="text-xs text-[var(--color-ink-muted)]">{actor?.type}</p>
                  </div>
                );
              },
            },
            { key: 'action', header: t('adminAudit.colAction'), cell: (row) => String(row.action) },
            {
              key: 'target',
              header: t('adminAudit.colTarget'),
              cell: (row) => {
                const target = row.target as { type?: string; id?: string };
                return `${target?.type ?? t('common.dash')} ${target?.id ? String(target.id).slice(0, 10) + '…' : ''}`;
              },
            },
            {
              key: 'tenant',
              header: t('adminAudit.colTenant'),
              cell: (row) => {
                const tenant = row.tenant as { slug?: string; name?: string } | null;
                return tenant?.slug ?? t('common.dash');
              },
            },
            {
              key: 'meta',
              header: t('adminAudit.colSummary'),
              cell: (row) => {
                const meta = row.metadata as Record<string, unknown> | null;
                if (!meta) return t('common.dash');
                if (meta.amount != null) {
                  return `${meta.direction ? String(meta.direction) + ' ' : ''}${String(meta.amount)} ${meta.currency ?? ''}`.trim();
                }
                return (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(row)}>
                    {t('adminAudit.details')}
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
        title={t('adminAudit.dialogTitle')}
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
    <Suspense fallback={<LoadingFallback />}>
      <AdminAuditPage />
    </Suspense>
  );
}
