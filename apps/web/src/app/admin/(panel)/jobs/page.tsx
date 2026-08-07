'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { DataTable } from '@/components/data/data-table';
import { PageHeader } from '@/components/data/page-header';
import { QueryState } from '@/components/data/query-state';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api/client';
import { useT } from '@/lib/i18n';
import { jobStatusTone, labelJobStatus } from '@/lib/status-labels';
import { formatDate } from '@/lib/utils';

function LoadingFallback() {
  const t = useT();
  return <div className="p-8 text-sm text-[var(--color-ink-muted)]">{t('common.loading')}</div>;
}

function AdminJobsPage() {
  const t = useT();
  const search = useSearchParams();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(search.get('status') ?? '');
  const [tenantId, setTenantId] = useState(search.get('tenantId') ?? '');

  const q = useQuery({
    queryKey: ['admin', 'jobs', page, status, tenantId],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (status) params.set('status', status);
      if (tenantId) params.set('tenantId', tenantId);
      return api.admin.jobs(params.toString());
    },
  });

  return (
    <div>
      <PageHeader title={t('adminJobs.title')} description={t('adminJobs.description')} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Input
          placeholder={t('adminJobs.filterTenantId')}
          value={tenantId}
          onChange={(e) => {
            setPage(1);
            setTenantId(e.target.value);
          }}
        />
        <select
          className="h-10 rounded-md border border-[var(--color-line)] bg-[var(--color-panel-elevated)] px-2 text-sm"
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
        >
          <option value="">{t('adminJobs.allStatuses')}</option>
          {['QUEUED', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED'].map(
            (s) => (
              <option key={s} value={s}>
                {labelJobStatus(s, t)}
              </option>
            ),
          )}
        </select>
      </div>
      <QueryState
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        isEmpty={!q.data?.items.length}
        emptyTitle={t('adminJobs.empty')}
        onRetry={() => void q.refetch()}
      >
        <DataTable
          columns={[
            {
              key: 'id',
              header: t('adminJobs.colJob'),
              cell: (row) => (
                <Link
                  href={`/admin/jobs/${row.id}`}
                  className="break-all font-medium hover:underline"
                >
                  {String(row.id)}
                </Link>
              ),
            },
            {
              key: 'tenant',
              header: t('adminJobs.colTenant'),
              cell: (row) => {
                const tenant = row.tenant as { slug?: string } | undefined;
                return tenant?.slug ?? String(row.tenantId);
              },
            },
            {
              key: 'type',
              header: t('adminJobs.colType'),
              cell: (row) => String(row.checkType),
            },
            {
              key: 'status',
              header: t('adminJobs.colStatus'),
              cell: (row) => (
                <Badge tone={jobStatusTone(row.status)}>
                  {labelJobStatus(row.status, t)}
                </Badge>
              ),
            },
            {
              key: 'progress',
              header: t('adminJobs.colItems'),
              cell: (row) =>
                t('adminJobs.itemsCell', {
                  ok: Number(row.successCount ?? 0),
                  total: Number(row.itemCount ?? 0),
                  fail: Number(row.failureCount ?? 0),
                }),
            },
            {
              key: 'created',
              header: t('adminJobs.colCreated'),
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
    <Suspense fallback={<LoadingFallback />}>
      <AdminJobsPage />
    </Suspense>
  );
}
