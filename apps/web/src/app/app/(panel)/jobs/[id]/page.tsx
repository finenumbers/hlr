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
import { formatDate } from '@/lib/utils';

export default function CabinetJobDetailPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const { tenantId } = useAuth();
  const [page, setPage] = useState(1);
  const job = useQuery({
    queryKey: ['cabinet', 'job', tenantId, id],
    queryFn: () => api.cabinet.job(id),
    enabled: Boolean(tenantId),
    refetchInterval: (query) => {
      const status = String(query.state.data?.status ?? '');
      return status === 'QUEUED' || status === 'PROCESSING' ? 3000 : false;
    },
  });
  const items = useQuery({
    queryKey: ['cabinet', 'job-items', tenantId, id, page],
    queryFn: () => api.cabinet.jobItems(id, `page=${page}&pageSize=50`),
    enabled: Boolean(tenantId),
  });

  const checkType = String(job.data?.checkType ?? '');
  const service = serviceLabel(checkType, t);

  const exportCsv = () => {
    const rows = items.data?.items ?? [];
    const header = [
      'checkType',
      'service',
      'phone',
      'status',
      'resultStatus',
      'isReachable',
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
                id: `${id.slice(0, 12)}…`,
              })
            : t('cabinetJobs.detailTitle', {
                service: t('common.loading'),
                id: `${id.slice(0, 12)}…`,
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
      <QueryState isLoading={job.isLoading} isError={job.isError} error={job.error}>
        <div className="mb-4 grid gap-4 sm:grid-cols-4">
          <Card>
            <p className="text-xs text-[var(--color-ink-muted)]">{t('cabinetJobs.status')}</p>
            <Badge className="mt-2">{String(job.data?.status)}</Badge>
          </Card>
          <Card>
            <p className="text-xs text-[var(--color-ink-muted)]">{t('cabinetJobs.service')}</p>
            <p className="mt-2 font-medium">{service}</p>
          </Card>
          <Card>
            <p className="text-xs text-[var(--color-ink-muted)]">{t('cabinetJobs.progress')}</p>
            <p className="mt-2 font-medium">
              {String(job.data?.successCount)}/{String(job.data?.itemCount)}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-[var(--color-ink-muted)]">{t('cabinetJobs.created')}</p>
            <p className="mt-2 font-medium">{formatDate(String(job.data?.createdAt))}</p>
          </Card>
        </div>
        <DataTable
          columns={[
            { key: 'phone', header: t('cabinetJobs.colPhone'), cell: (r) => String(r.phoneE164) },
            { key: 'status', header: t('cabinetJobs.colStatus'), cell: (r) => String(r.status) },
            {
              key: 'result',
              header: t('cabinetJobs.colResult'),
              cell: (r) => String(r.resultStatus ?? t('common.dash')),
            },
            {
              key: 'reachable',
              header: t('cabinetJobs.colReachable'),
              cell: (r) => (r.isReachable == null ? t('common.dash') : String(r.isReachable)),
            },
          ]}
          rows={(items.data?.items ?? []) as Array<Record<string, unknown>>}
          rowKey={(r) => String(r.id)}
          page={page}
          pageSize={50}
          total={items.data?.total ?? 0}
          onPageChange={setPage}
        />
      </QueryState>
    </div>
  );
}
