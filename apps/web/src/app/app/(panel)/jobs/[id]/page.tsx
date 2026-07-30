'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { DataTable } from '@/components/data/data-table';
import { PageHeader } from '@/components/data/page-header';
import { QueryState } from '@/components/data/query-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api/client';
import { serviceLabel } from '@/lib/check-type';
import { useAuth } from '@/lib/auth/auth-context';
import { useT } from '@/lib/i18n';
import { HLR_CSV_EXTRA_FIELDS, jobItemResultColumns } from '@/lib/job-item-columns';
import { formatDate } from '@/lib/utils';

export default function CabinetJobDetailPage() {
  const t = useT();
  const params = useParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const displayId = id || t('common.dash');
  const { tenantId } = useAuth();
  const [page, setPage] = useState(1);
  const job = useQuery({
    queryKey: ['cabinet', 'job', tenantId, id],
    queryFn: () => api.cabinet.job(id),
    enabled: Boolean(tenantId && id),
    refetchInterval: (query) => {
      const status = String(query.state.data?.status ?? '');
      return status === 'QUEUED' || status === 'PROCESSING' ? 3000 : false;
    },
  });
  const items = useQuery({
    queryKey: ['cabinet', 'job-items', tenantId, id, page],
    queryFn: () => api.cabinet.jobItems(id, `page=${page}&pageSize=50`),
    enabled: Boolean(tenantId && id),
    refetchInterval: () => {
      const status = String(job.data?.status ?? '');
      return status === 'QUEUED' || status === 'PROCESSING' ? 3000 : false;
    },
  });

  const checkType = String(job.data?.checkType ?? '');
  const service = serviceLabel(checkType, t);

  const isHlr = checkType === 'HLR';

  const exportCsv = () => {
    const rows = items.data?.items ?? [];
    const header = [
      'checkType',
      'service',
      'phone',
      'status',
      'resultStatus',
      'isReachable',
      ...(isHlr ? [...HLR_CSV_EXTRA_FIELDS] : []),
      'errorMessage',
    ];
    const lines = [
      header.join(','),
      ...rows.map((r) =>
        [
          checkType,
          JSON.stringify(service),
          r.phoneE164,
          r.status,
          r.resultStatus ?? '',
          r.isReachable ?? '',
          ...(isHlr
            ? HLR_CSV_EXTRA_FIELDS.map((field) => {
                const value = r[field];
                return typeof value === 'string' ? JSON.stringify(value) : (value ?? '');
              })
            : []),
          JSON.stringify(r.errorMessage ?? ''),
        ].join(','),
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const slug = checkType === 'PING' ? 'ping-sms' : checkType === 'HLR' ? 'hlr' : 'job';
    a.download = `${slug}-${id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        title={
          job.data
            ? t('cabinetJobs.detailTitle', {
                service,
                id: displayId,
              })
            : t('cabinetJobs.detailTitle', {
                service: t('common.loading'),
                id: displayId,
              })
        }
        description={t('cabinetJobs.detailDescription')}
        actions={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={exportCsv}
            disabled={!job.data}
          >
            {t('cabinetJobs.exportCsv')}
          </Button>
        }
      />
      <QueryState
        isLoading={job.isLoading || !job.data}
        isError={job.isError}
        error={job.error}
        onRetry={() => void job.refetch()}
      >
        <div className="mb-4 grid gap-4 sm:grid-cols-4">
          <Card>
            <p className="text-xs text-[var(--color-ink-muted)]">{t('cabinetJobs.status')}</p>
            <Badge className="mt-2">{String(job.data?.status ?? t('common.dash'))}</Badge>
          </Card>
          <Card>
            <p className="text-xs text-[var(--color-ink-muted)]">{t('cabinetJobs.service')}</p>
            <p className="mt-2 font-medium">{service}</p>
          </Card>
          <Card>
            <p className="text-xs text-[var(--color-ink-muted)]">{t('cabinetJobs.progress')}</p>
            <p className="mt-2 font-medium">
              {Number(job.data?.successCount ?? 0)}/{Number(job.data?.itemCount ?? 0)}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-[var(--color-ink-muted)]">{t('cabinetJobs.created')}</p>
            <p className="mt-2 font-medium">{formatDate(job.data?.createdAt as string | undefined)}</p>
          </Card>
        </div>
        <QueryState
          isLoading={items.isLoading && !items.data}
          isError={items.isError}
          error={items.error}
          isEmpty={!items.data?.items.length}
          emptyTitle={t('cabinetJobs.emptyItems')}
          onRetry={() => void items.refetch()}
        >
          <DataTable
            columns={jobItemResultColumns(t, {
              prefix: 'cabinetJobs',
              includeHlr: isHlr,
            })}
            rows={(items.data?.items ?? []) as Array<Record<string, unknown>>}
            rowKey={(r) => String(r.id)}
            page={page}
            pageSize={50}
            total={items.data?.total ?? 0}
            onPageChange={setPage}
          />
        </QueryState>
      </QueryState>
    </div>
  );
}
