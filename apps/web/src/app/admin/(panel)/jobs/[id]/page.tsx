'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { DataTable } from '@/components/data/data-table';
import { PageHeader } from '@/components/data/page-header';
import { QueryState } from '@/components/data/query-state';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api/client';
import { formatDate } from '@/lib/utils';

export default function AdminJobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [page, setPage] = useState(1);
  const job = useQuery({
    queryKey: ['admin', 'job', id],
    queryFn: () => api.admin.job(id),
  });
  const items = useQuery({
    queryKey: ['admin', 'job-items', id, page],
    queryFn: () => api.admin.jobItems(id, `page=${page}&pageSize=20`),
  });

  const j = job.data;

  return (
    <div>
      <PageHeader title={`Job ${id.slice(0, 12)}…`} description="Results preview and progress." />
      <QueryState
        isLoading={job.isLoading}
        isError={job.isError}
        error={job.error}
        onRetry={() => void job.refetch()}
      >
        <div className="mb-4 grid gap-4 sm:grid-cols-4">
          <Card>
            <p className="text-xs text-[var(--color-ink-muted)]">Status</p>
            <Badge className="mt-2">{String(j?.status)}</Badge>
          </Card>
          <Card>
            <p className="text-xs text-[var(--color-ink-muted)]">Type / source</p>
            <p className="mt-2 font-medium">
              {String(j?.checkType)} · {String(j?.source)}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-[var(--color-ink-muted)]">Progress</p>
            <p className="mt-2 font-medium">
              {String(j?.successCount)}/{String(j?.itemCount)} · fail {String(j?.failureCount)}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-[var(--color-ink-muted)]">Created</p>
            <p className="mt-2 font-medium">{formatDate(String(j?.createdAt))}</p>
          </Card>
        </div>
        <QueryState
          isLoading={items.isLoading}
          isError={items.isError}
          error={items.error}
          isEmpty={!items.data?.items.length}
          emptyTitle="No items"
        >
          <DataTable
            columns={[
              { key: 'phone', header: 'Phone', cell: (r) => String(r.phoneE164) },
              { key: 'status', header: 'Status', cell: (r) => String(r.status) },
              { key: 'result', header: 'Result', cell: (r) => String(r.resultStatus ?? '—') },
              {
                key: 'reachable',
                header: 'Reachable',
                cell: (r) => (r.isReachable == null ? '—' : String(r.isReachable)),
              },
              { key: 'error', header: 'Error', cell: (r) => String(r.errorMessage ?? '—') },
            ]}
            rows={(items.data?.items ?? []) as Array<Record<string, unknown>>}
            rowKey={(r) => String(r.id)}
            page={page}
            pageSize={20}
            total={items.data?.total ?? 0}
            onPageChange={setPage}
          />
        </QueryState>
      </QueryState>
    </div>
  );
}
