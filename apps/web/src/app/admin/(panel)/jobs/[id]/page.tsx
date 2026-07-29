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
import { useT } from '@/lib/i18n';
import { formatDate } from '@/lib/utils';

export default function AdminJobDetailPage() {
  const t = useT();
  const params = useParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const shortId = id ? `${id.slice(0, 12)}…` : t('common.dash');
  const [page, setPage] = useState(1);
  const job = useQuery({
    queryKey: ['admin', 'job', id],
    queryFn: () => api.admin.job(id),
    enabled: Boolean(id),
  });
  const items = useQuery({
    queryKey: ['admin', 'job-items', id, page],
    queryFn: () => api.admin.jobItems(id, `page=${page}&pageSize=20`),
    enabled: Boolean(id),
  });

  const j = job.data;

  return (
    <div>
      <PageHeader
        title={t('adminJobs.detailTitle', { id: shortId })}
        description={t('adminJobs.detailDescription')}
      />
      <QueryState
        isLoading={job.isLoading || !job.data}
        isError={job.isError}
        error={job.error}
        onRetry={() => void job.refetch()}
      >
        <div className="mb-4 grid gap-4 sm:grid-cols-4">
          <Card>
            <p className="text-xs text-[var(--color-ink-muted)]">{t('adminJobs.status')}</p>
            <Badge className="mt-2">{String(j?.status ?? t('common.dash'))}</Badge>
          </Card>
          <Card>
            <p className="text-xs text-[var(--color-ink-muted)]">{t('adminJobs.typeSource')}</p>
            <p className="mt-2 font-medium">
              {String(j?.checkType ?? t('common.dash'))} · {String(j?.source ?? t('common.dash'))}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-[var(--color-ink-muted)]">{t('adminJobs.progress')}</p>
            <p className="mt-2 font-medium">
              {t('adminJobs.progressCell', {
                ok: String(j?.successCount ?? 0),
                total: String(j?.itemCount ?? 0),
                fail: String(j?.failureCount ?? 0),
              })}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-[var(--color-ink-muted)]">{t('adminJobs.created')}</p>
            <p className="mt-2 font-medium">{formatDate(j?.createdAt as string | undefined)}</p>
          </Card>
        </div>
        <QueryState
          isLoading={items.isLoading}
          isError={items.isError}
          error={items.error}
          isEmpty={!items.data?.items.length}
          emptyTitle={t('adminJobs.emptyItems')}
        >
          <DataTable
            columns={[
              { key: 'phone', header: t('adminJobs.colPhone'), cell: (r) => String(r.phoneE164) },
              { key: 'status', header: t('adminJobs.colStatus'), cell: (r) => String(r.status) },
              {
                key: 'result',
                header: t('adminJobs.colResult'),
                cell: (r) => String(r.resultStatus ?? t('common.dash')),
              },
              {
                key: 'reachable',
                header: t('adminJobs.colReachable'),
                cell: (r) => (r.isReachable == null ? t('common.dash') : String(r.isReachable)),
              },
              {
                key: 'error',
                header: t('adminJobs.colError'),
                cell: (r) => String(r.errorMessage ?? t('common.dash')),
              },
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
