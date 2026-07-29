'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { DataTable } from '@/components/data/data-table';
import { PageHeader } from '@/components/data/page-header';
import { QueryState } from '@/components/data/query-state';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-context';
import { formatDate } from '@/lib/utils';

export default function CabinetJobsPage() {
  const { tenantId } = useAuth();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const q = useQuery({
    queryKey: ['cabinet', 'jobs', tenantId, page, status],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (status) params.set('status', status);
      return api.cabinet.jobs(params.toString());
    },
    enabled: Boolean(tenantId),
  });

  return (
    <div>
      <PageHeader title="Jobs" description="Your tenant job history and progress." />
      <div className="mb-4">
        <select
          className="h-10 rounded-md border border-[var(--color-line)] bg-[var(--color-panel-elevated)] px-2 text-sm"
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
        >
          <option value="">All statuses</option>
          {['QUEUED', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <QueryState
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        isEmpty={!q.data?.items.length}
        emptyTitle="No jobs yet"
        emptyDescription="Submit a single check or bulk list to get started."
        onRetry={() => void q.refetch()}
      >
        <DataTable
          columns={[
            {
              key: 'id',
              header: 'Job',
              cell: (row) => (
                <Link href={`/app/jobs/${row.id}`} className="font-medium hover:underline">
                  {String(row.id).slice(0, 12)}…
                </Link>
              ),
            },
            { key: 'type', header: 'Type', cell: (row) => String(row.checkType) },
            {
              key: 'status',
              header: 'Status',
              cell: (row) => <Badge>{String(row.status)}</Badge>,
            },
            {
              key: 'progress',
              header: 'Progress',
              cell: (row) => `${row.successCount ?? 0}/${row.itemCount ?? 0}`,
            },
            { key: 'created', header: 'Created', cell: (row) => formatDate(String(row.createdAt)) },
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
