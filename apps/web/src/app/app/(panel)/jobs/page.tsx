'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useState } from 'react';

import { DataTable } from '@/components/data/data-table';
import { PageHeader } from '@/components/data/page-header';
import { QueryState } from '@/components/data/query-state';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api/client';
import { isCheckType, serviceLabel, type CheckType } from '@/lib/check-type';
import { useAuth } from '@/lib/auth/auth-context';
import { useT } from '@/lib/i18n';
import { jobStatusTone, labelJobStatus } from '@/lib/status-labels';
import { formatDate } from '@/lib/utils';

function LoadingFallback() {
  const t = useT();
  return <div className="p-8 text-sm text-[var(--color-ink-muted)]">{t('common.loading')}</div>;
}

function CabinetJobsPage() {
  const t = useT();
  const { tenantId } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [page, setPage] = useState(1);
  const status = searchParams.get('status') ?? '';
  const checkTypeRaw = searchParams.get('checkType');
  const checkType: '' | CheckType = isCheckType(checkTypeRaw) ? checkTypeRaw : '';

  const replaceFilters = useCallback(
    (next: { status?: string; checkType?: '' | CheckType }) => {
      const params = new URLSearchParams(searchParams.toString());
      const nextStatus = next.status === undefined ? status : next.status;
      const nextType = next.checkType === undefined ? checkType : next.checkType;
      if (nextStatus) params.set('status', nextStatus);
      else params.delete('status');
      if (nextType) params.set('checkType', nextType);
      else params.delete('checkType');
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
      setPage(1);
    },
    [checkType, pathname, router, searchParams, status],
  );

  const q = useQuery({
    queryKey: ['cabinet', 'jobs', tenantId, page, status, checkType],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (status) params.set('status', status);
      if (checkType) params.set('checkType', checkType);
      return api.cabinet.jobs(params.toString());
    },
    enabled: Boolean(tenantId),
  });

  return (
    <div>
      <PageHeader title={t('cabinetJobs.title')} description={t('cabinetJobs.description')} />
      <div className="mb-4 flex flex-wrap gap-2">
        <select
          className="h-10 rounded-md border border-[var(--color-line)] bg-[var(--color-panel-elevated)] px-2 text-sm"
          value={checkType}
          onChange={(e) => {
            const value = e.target.value;
            replaceFilters({ checkType: isCheckType(value) ? value : '' });
          }}
          aria-label={t('cabinetJobs.filterService')}
        >
          <option value="">{t('cabinetJobs.allServices')}</option>
          <option value="HLR">{t('common.serviceHlr')}</option>
          <option value="PING">{t('common.servicePing')}</option>
        </select>
        <select
          className="h-10 rounded-md border border-[var(--color-line)] bg-[var(--color-panel-elevated)] px-2 text-sm"
          value={status}
          onChange={(e) => {
            replaceFilters({ status: e.target.value });
          }}
          aria-label={t('cabinetJobs.allStatuses')}
        >
          <option value="">{t('cabinetJobs.allStatuses')}</option>
          {['QUEUED', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'].map((s) => (
            <option key={s} value={s}>
              {labelJobStatus(s, t)}
            </option>
          ))}
        </select>
      </div>
      <QueryState
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        isEmpty={!q.data?.items.length}
        emptyTitle={t('cabinetJobs.emptyTitle')}
        emptyDescription={t('cabinetJobs.emptyDescription')}
        onRetry={() => void q.refetch()}
      >
        <DataTable
          columns={[
            {
              key: 'id',
              header: t('cabinetJobs.colJob'),
              cell: (row) => (
                <Link
                  href={`/app/jobs/${row.id}`}
                  className="break-all font-medium hover:underline"
                >
                  {String(row.id)}
                </Link>
              ),
            },
            {
              key: 'service',
              header: t('cabinetJobs.colService'),
              cell: (row) => serviceLabel(String(row.checkType), t),
            },
            {
              key: 'status',
              header: t('cabinetJobs.colStatus'),
              cell: (row) => (
                <Badge tone={jobStatusTone(row.status)}>{labelJobStatus(row.status, t)}</Badge>
              ),
            },
            {
              key: 'progress',
              header: t('cabinetJobs.colProgress'),
              cell: (row) => `${row.successCount ?? 0}/${row.itemCount ?? 0}`,
            },
            {
              key: 'created',
              header: t('cabinetJobs.colCreated'),
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
      <CabinetJobsPage />
    </Suspense>
  );
}
