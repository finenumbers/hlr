'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { DataTable } from '@/components/data/data-table';
import { PageHeader } from '@/components/data/page-header';
import { QueryState } from '@/components/data/query-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { api, ApiError } from '@/lib/api/client';
import { downloadBlob } from '@/lib/csv';
import { useI18n, useT } from '@/lib/i18n';
import { jobItemResultColumns } from '@/lib/job-item-columns';
import { labelJobStatus } from '@/lib/status-labels';
import { formatDate } from '@/lib/utils';

export default function AdminJobDetailPage() {
  const t = useT();
  const { locale } = useI18n();
  const params = useParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const displayId = id || t('common.dash');
  const [page, setPage] = useState(1);
  const [healError, setHealError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const qc = useQueryClient();
  const job = useQuery({
    queryKey: ['admin', 'job', id],
    queryFn: () => api.admin.job(id),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = String(query.state.data?.status ?? '');
      return status === 'QUEUED' || status === 'PROCESSING' ? 3000 : false;
    },
  });
  const items = useQuery({
    queryKey: ['admin', 'job-items', id, page],
    queryFn: () => api.admin.jobItems(id, `page=${page}&pageSize=20`),
    enabled: Boolean(id),
    refetchInterval: () => {
      const status = String(job.data?.status ?? '');
      return status === 'QUEUED' || status === 'PROCESSING' ? 3000 : false;
    },
  });

  const heal = useMutation({
    mutationFn: () => api.admin.finalizeJob(id),
    onSuccess: async () => {
      setHealError(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['admin', 'job', id] }),
        qc.invalidateQueries({ queryKey: ['admin', 'job-items', id] }),
      ]);
    },
    onError: (err) => {
      setHealError(err instanceof ApiError ? err.message : t('adminJobs.healFailed'));
    },
  });

  const j = job.data;
  const status = String(j?.status ?? '');
  const canHeal = status === 'QUEUED' || status === 'PROCESSING';
  const isHlr = String(j?.checkType ?? '') === 'HLR';
  const jobError =
    j?.errorCode || j?.errorMessage
      ? [j?.errorCode, j?.errorMessage].filter(Boolean).join(' — ')
      : null;

  const exportCsv = async () => {
    if (!id) return;
    setExporting(true);
    setExportError(null);
    try {
      const { blob, filename } = await api.admin.jobItemsExport(id, locale);
      downloadBlob(filename ?? `job-${id}.csv`, blob);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : t('adminJobs.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('adminJobs.detailTitle', { id: displayId })}
        description={t('adminJobs.detailDescription')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void exportCsv()}
              disabled={!job.data || exporting}
            >
              {exporting ? t('common.loading') : t('adminJobs.exportCsv')}
            </Button>
            {canHeal ? (
              <Button
                type="button"
                size="sm"
                onClick={() => heal.mutate()}
                disabled={heal.isPending || !id}
              >
                {heal.isPending ? t('common.loading') : t('adminJobs.healFinalize')}
              </Button>
            ) : null}
          </div>
        }
      />
      {healError ? (
        <p className="mb-3 text-sm text-[var(--color-danger)]">{healError}</p>
      ) : null}
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
            <p className="text-xs text-[var(--color-ink-muted)]">{t('adminJobs.status')}</p>
            <Badge className="mt-2">{labelJobStatus(j?.status, t)}</Badge>
          </Card>
          <Card className="h-full">
            <p className="text-xs text-[var(--color-ink-muted)]">{t('adminJobs.typeSource')}</p>
            <p className="mt-2 font-medium">
              {String(j?.checkType ?? t('common.dash'))} · {String(j?.source ?? t('common.dash'))}
            </p>
          </Card>
          <Card className="h-full">
            <p className="text-xs text-[var(--color-ink-muted)]">{t('adminJobs.progress')}</p>
            <p className="mt-2 font-medium">
              {t('adminJobs.progressCell', {
                ok: String(j?.successCount ?? 0),
                total: String(j?.itemCount ?? 0),
                fail: String(j?.failureCount ?? 0),
              })}
            </p>
          </Card>
          <Card className="h-full">
            <p className="text-xs text-[var(--color-ink-muted)]">{t('adminJobs.created')}</p>
            <p className="mt-2 font-medium">{formatDate(j?.createdAt as string | undefined)}</p>
          </Card>
        </div>
        {jobError ? (
          <Card className="mb-4 border-[color-mix(in_oklab,var(--color-danger)_35%,transparent)]">
            <p className="text-xs text-[var(--color-ink-muted)]">{t('adminJobs.jobError')}</p>
            <p className="mt-2 text-sm text-[var(--color-danger)]">{jobError}</p>
          </Card>
        ) : null}
        <QueryState
          isLoading={items.isLoading}
          isError={items.isError}
          error={items.error}
          isEmpty={!items.data?.items.length}
          emptyTitle={t('adminJobs.emptyItems')}
          onRetry={() => void items.refetch()}
        >
          <DataTable
            columns={jobItemResultColumns(t, {
              prefix: 'adminJobs',
              includeHlr: isHlr,
              includeError: true,
            })}
            rows={(items.data?.items ?? []) as Array<Record<string, unknown>>}
            rowKey={(r) => String(r.id)}
            rowClassName={(r) =>
              isHlr && r.resultStatus === 'unreachable'
                ? 'bg-[color-mix(in_oklab,var(--color-danger)_12%,transparent)] hover:bg-[color-mix(in_oklab,var(--color-danger)_18%,transparent)]'
                : undefined
            }
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
