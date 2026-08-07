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
import { downloadBlob } from '@/lib/csv';
import { useI18n, useT } from '@/lib/i18n';
import { jobItemResultColumns } from '@/lib/job-item-columns';
import {
  isSubmitTimeProviderFailure,
  providerItemErrorLabel,
} from '@/lib/smsc-err';
import { labelJobStatus } from '@/lib/status-labels';
import { formatDate } from '@/lib/utils';

export default function CabinetJobDetailPage() {
  const t = useT();
  const { locale } = useI18n();
  const params = useParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const displayId = id || t('common.dash');
  const { tenantId } = useAuth();
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
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
  const jobError =
    job.data?.errorCode || job.data?.errorMessage
      ? [job.data?.errorCode, job.data?.errorMessage].filter(Boolean).join(' — ')
      : null;

  const itemRows = (items.data?.items ?? []) as Array<Record<string, unknown>>;
  const uniformProviderError = (() => {
    if (String(job.data?.status ?? '') !== 'FAILED' || itemRows.length === 0) {
      return null;
    }
    const codes = itemRows.map((r) => String(r.errorCode ?? ''));
    if (!codes.every((c) => c && c === codes[0])) return null;
    const sample = itemRows[0]!;
    return providerItemErrorLabel(codes[0], t, {
      preferApi: isSubmitTimeProviderFailure(sample),
    });
  })();

  const exportXlsx = async () => {
    if (!id) return;
    setExporting(true);
    setExportError(null);
    try {
      const { blob, filename } = await api.cabinet.jobItemsExport(id, locale);
      downloadBlob(filename ?? `job-${id}.xlsx`, blob);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : t('cabinetJobs.exportFailed'));
    } finally {
      setExporting(false);
    }
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
            onClick={() => void exportXlsx()}
            disabled={!job.data || exporting}
          >
            {exporting ? t('common.loading') : t('cabinetJobs.exportXlsx')}
          </Button>
        }
      />
      {exportError ? (
        <p className="mb-3 text-sm text-[var(--color-danger)]">{exportError}</p>
      ) : null}
      <QueryState
        isLoading={job.isLoading || !job.data}
        isError={job.isError}
        error={job.error}
        onRetry={() => void job.refetch()}
      >
        <div className="mb-4 grid items-stretch gap-4 sm:grid-cols-4">
          <Card className="h-full">
            <p className="text-xs text-[var(--color-ink-muted)]">{t('cabinetJobs.status')}</p>
            <Badge className="mt-2">{labelJobStatus(job.data?.status, t)}</Badge>
          </Card>
          <Card className="h-full">
            <p className="text-xs text-[var(--color-ink-muted)]">{t('cabinetJobs.service')}</p>
            <p className="mt-2 font-medium">{service}</p>
          </Card>
          <Card className="h-full">
            <p className="text-xs text-[var(--color-ink-muted)]">{t('cabinetJobs.progress')}</p>
            <p className="mt-2 font-medium">
              {Number(job.data?.successCount ?? 0)}/{Number(job.data?.itemCount ?? 0)}
            </p>
          </Card>
          <Card className="h-full">
            <p className="text-xs text-[var(--color-ink-muted)]">{t('cabinetJobs.created')}</p>
            <p className="mt-2 font-medium">{formatDate(job.data?.createdAt as string | undefined)}</p>
          </Card>
        </div>
        {jobError ? (
          <Card className="mb-4 border-[color-mix(in_oklab,var(--color-danger)_35%,transparent)]">
            <p className="text-xs text-[var(--color-ink-muted)]">{t('cabinetJobs.jobError')}</p>
            <p className="mt-2 text-sm text-[var(--color-danger)]">{jobError}</p>
          </Card>
        ) : null}
        {uniformProviderError ? (
          <Card className="mb-4 border-[color-mix(in_oklab,var(--color-danger)_35%,transparent)]">
            <p className="text-xs text-[var(--color-ink-muted)]">{t('cabinetJobs.jobError')}</p>
            <p className="mt-2 text-sm text-[var(--color-danger)]">
              {t('cabinetJobs.uniformItemError', { error: uniformProviderError })}
            </p>
          </Card>
        ) : null}
        <QueryState
          isLoading={items.isLoading && !items.data}
          isError={items.isError}
          error={items.error}
          isEmpty={!items.data?.items.length}
          emptyTitle={
            Number(job.data?.itemCount ?? 0) === 0 &&
            (job.data?.status === 'QUEUED' || job.data?.status === 'PROCESSING')
              ? t('cabinetJobs.csvQueuing')
              : t('cabinetJobs.emptyItems')
          }
          onRetry={() => void items.refetch()}
        >
          <DataTable
            columns={jobItemResultColumns(t, {
              prefix: 'cabinetJobs',
              includeHlr: isHlr,
              includeError: true,
            })}
            rows={itemRows}
            rowKey={(r) => String(r.id)}
            rowClassName={(r) =>
              isHlr && r.resultStatus === 'unreachable'
                ? 'bg-[color-mix(in_oklab,var(--color-danger)_12%,transparent)] hover:bg-[color-mix(in_oklab,var(--color-danger)_18%,transparent)]'
                : undefined
            }
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
