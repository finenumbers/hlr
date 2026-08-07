'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, type DragEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api/client';
import type { CheckType } from '@/lib/check-type';
import { useT } from '@/lib/i18n';
import { cn, formatMoney } from '@/lib/utils';

type PreviewState = {
  id: string;
  status: string;
  stats: {
    rowCount: number;
    validCount: number;
    invalidCount: number;
    deduplicatedCount: number;
  };
  unitSellPrice: string | null;
  currency: string;
  invalidSamples: Array<{ input?: string; reason?: string }>;
  phones: { items: string[]; page: number; pageSize: number; total: number };
};

function isAllowedCsvFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith('.csv') ||
    name.endsWith('.txt') ||
    file.type === 'text/csv' ||
    file.type === 'text/plain'
  );
}

export function ProductSubmitPanel({
  checkType,
  available,
  sellPrice,
  currency,
  compactTitle = false,
}: {
  checkType: CheckType;
  available: boolean;
  sellPrice: string | null;
  currency: string;
  /** When true, omit the H2 (page header already names the product). */
  compactTitle?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phonesText, setPhonesText] = useState('');
  const [estimate, setEstimate] = useState<Record<string, unknown> | null>(null);
  const [csvEstimate, setCsvEstimate] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [phonePage, setPhonePage] = useState(1);
  const [dragOver, setDragOver] = useState(false);

  const phones = useMemo(
    () =>
      phonesText
        .split(/[\n,;]+/)
        .map((p) => p.trim())
        .filter(Boolean),
    [phonesText],
  );

  const title =
    checkType === 'HLR' ? t('cabinetSubmit.optionHlr') : t('cabinetSubmit.optionPing');
  const blockedHint =
    checkType === 'HLR'
      ? t('cabinetSubmit.hlrUnavailable')
      : t('cabinetSubmit.pingUnavailable');

  const phonesQuery = useQuery({
    queryKey: ['cabinet', 'csv-preview-phones', preview?.id, phonePage],
    queryFn: () => api.cabinet.csvPreviewPhones(preview!.id, phonePage, 50),
    enabled: Boolean(preview?.id && preview.status === 'READY'),
  });

  const estimateMut = useMutation({
    mutationFn: () =>
      api.cabinet.estimate({
        checkType,
        unitCount: Math.max(phones.length, 1),
      }),
    onSuccess: (data) => setEstimate(data),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : t('cabinetSubmit.estimateFailed')),
  });

  const submitMut = useMutation({
    mutationFn: async () => {
      if (phones.length === 1) {
        return api.cabinet.submitCheck({ checkType, phones });
      }
      return api.cabinet.submitJob({ checkType, phones });
    },
    onSuccess: (job) => {
      const id =
        (job as { job?: { id?: string }; id?: string }).job?.id ??
        (job as { id?: string }).id;
      if (id) router.push(`/app/jobs/${id}`);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : t('cabinetSubmit.submitFailed')),
  });

  const previewMut = useMutation({
    mutationFn: async (file: File) => api.cabinet.createCsvPreview(checkType, file),
    onSuccess: (data) => {
      setPreview(data as PreviewState);
      setPhonePage(1);
      setCsvEstimate(null);
      setCsvError(null);
    },
    onError: (err) =>
      setCsvError(err instanceof ApiError ? err.message : t('cabinetSubmit.submitFailed')),
  });

  const csvEstimateMut = useMutation({
    mutationFn: async () => {
      if (!preview?.id) throw new Error('No preview');
      return api.cabinet.estimateCsvPreview(preview.id);
    },
    onSuccess: (data) => setCsvEstimate(data),
    onError: (err) =>
      setCsvError(err instanceof ApiError ? err.message : t('cabinetSubmit.estimateFailed')),
  });

  const csvSubmitMut = useMutation({
    mutationFn: async () => {
      if (!preview?.id) throw new Error('No preview');
      return api.cabinet.submitCsvPreview(preview.id);
    },
    onSuccess: (job) => {
      const id =
        (job as { job?: { id?: string }; id?: string }).job?.id ??
        (job as { id?: string }).id;
      if (id) router.push(`/app/jobs/${id}`);
    },
    onError: (err) =>
      setCsvError(err instanceof ApiError ? err.message : t('cabinetSubmit.submitFailed')),
  });

  const busy =
    previewMut.isPending ||
    csvEstimateMut.isPending ||
    csvSubmitMut.isPending ||
    submitMut.isPending ||
    estimateMut.isPending;

  const startPreview = (file: File | null | undefined) => {
    if (!file) return;
    if (!isAllowedCsvFile(file)) {
      setCsvError(t('cabinetSubmit.csvTypeInvalid'));
      return;
    }
    setCsvFile(file);
    setPreview(null);
    setCsvEstimate(null);
    setCsvError(null);
    previewMut.mutate(file);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    if (busy) return;
    const file = event.dataTransfer.files?.[0];
    startPreview(file);
  };

  const phoneItems =
    (phonesQuery.data?.items as string[] | undefined) ?? preview?.phones.items ?? [];
  const phoneTotal = phonesQuery.data?.total ?? preview?.phones.total ?? 0;
  const phonePageSize = phonesQuery.data?.pageSize ?? preview?.phones.pageSize ?? 50;
  const phonePageCount = Math.max(1, Math.ceil(phoneTotal / phonePageSize));

  return (
    <Card className={`space-y-4 ${available ? '' : 'opacity-70'}`}>
      <div>
        {!compactTitle ? <h2 className="text-base font-semibold">{title}</h2> : null}
        {available && sellPrice ? (
          <p className={`text-sm text-[var(--color-ink-muted)] ${compactTitle ? '' : 'mt-1'}`}>
            {t('cabinetSubmit.unitPrice', {
              amount: formatMoney(sellPrice, currency),
            })}
          </p>
        ) : (
          <p className={`text-sm text-[var(--color-danger)] ${compactTitle ? '' : 'mt-1'}`}>
            {blockedHint}
          </p>
        )}
      </div>

      {!available ? (
        <p className="text-sm text-[var(--color-ink-muted)]">{t('cabinetSubmit.tariffRequired')}</p>
      ) : (
        <>
          <div>
            <Label>{t('cabinetSubmit.csvFile')}</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="sr-only"
              tabIndex={-1}
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                e.target.value = '';
                startPreview(file);
              }}
            />
            <div
              role="button"
              tabIndex={0}
              className={cn(
                'mt-1 rounded-md border border-dashed border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-6 text-center transition',
                dragOver && 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]',
                busy ? 'pointer-events-none opacity-60' : 'cursor-pointer hover:bg-[var(--color-panel-elevated)]',
              )}
              onClick={() => {
                if (!busy) fileInputRef.current?.click();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (!busy) fileInputRef.current?.click();
                }
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragOver(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragOver(false);
              }}
              onDrop={onDrop}
            >
              <p className="text-sm font-medium">{t('cabinetSubmit.csvDropTitle')}</p>
              <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{t('cabinetSubmit.csvHint')}</p>
              {csvFile ? (
                <p className="mt-2 text-sm font-mono">{csvFile.name}</p>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                {previewMut.isPending
                  ? t('cabinetSubmit.loadingPreview')
                  : t('cabinetSubmit.uploadCsv')}
              </Button>
            </div>
            {csvError ? (
              <p className="mt-2 text-sm text-[var(--color-danger)]">{csvError}</p>
            ) : null}

            {preview ? (
              <div className="mt-4 space-y-3 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-3">
                <p className="text-sm font-semibold">{t('cabinetSubmit.preparedJob')}</p>
                <p className="text-sm text-[var(--color-ink-muted)]">
                  {t('cabinetSubmit.previewStats', {
                    rows: preview.stats.rowCount,
                    valid: preview.stats.validCount,
                    invalid: preview.stats.invalidCount,
                    dupes: preview.stats.deduplicatedCount,
                  })}
                </p>
                {preview.status === 'INVALID' ? (
                  <div className="space-y-1 text-sm text-[var(--color-danger)]">
                    <p>{t('cabinetSubmit.previewInvalid')}</p>
                    {preview.invalidSamples.slice(0, 5).map((sample, idx) => (
                      <p key={`${sample.input}-${idx}`}>
                        {sample.input}: {sample.reason}
                      </p>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="max-h-64 overflow-auto rounded border border-[var(--color-line)] bg-[var(--color-panel-elevated)]">
                      <ol className="space-y-0.5 px-3 py-2 text-sm">
                        {phoneItems.map((phone, idx) => {
                          const n = (phonePage - 1) * phonePageSize + idx + 1;
                          return (
                            <li
                              key={`${n}-${phone}`}
                              className="flex gap-3 font-mono tabular-nums"
                            >
                              <span
                                className="shrink-0 text-right text-[var(--color-ink-muted)]"
                                style={{
                                  width: `${String(Math.max(phoneTotal, 1)).length + 1}ch`,
                                }}
                              >
                                {n}.
                              </span>
                              <span>{phone}</span>
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                    {phonePageCount > 1 ? (
                      <div className="flex items-center gap-2 text-sm">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={phonePage <= 1 || phonesQuery.isFetching}
                          onClick={() => setPhonePage((p) => Math.max(1, p - 1))}
                        >
                          {t('common.prev')}
                        </Button>
                        <span>
                          {phonePage}/{phonePageCount}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={phonePage >= phonePageCount || phonesQuery.isFetching}
                          onClick={() => setPhonePage((p) => p + 1)}
                        >
                          {t('common.next')}
                        </Button>
                      </div>
                    ) : null}
                    {csvEstimate ? (
                      <p className="text-sm">
                        {t('cabinetSubmit.estimated', {
                          amount: formatMoney(
                            String(csvEstimate.estimatedSellTotal ?? '0'),
                            String(csvEstimate.currency ?? currency),
                          ),
                        })}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => {
                          setCsvError(null);
                          csvEstimateMut.mutate();
                        }}
                      >
                        {t('cabinetSubmit.estimatePrice')}
                      </Button>
                      <Button
                        type="button"
                        disabled={busy || preview.status !== 'READY'}
                        onClick={() => {
                          setCsvError(null);
                          csvSubmitMut.mutate();
                        }}
                      >
                        {csvSubmitMut.isPending
                          ? t('cabinetSubmit.submitting')
                          : t('cabinetSubmit.submit')}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </div>

          <p className="text-center text-xs font-bold text-[var(--color-ink-muted)]">
            {t('cabinetSubmit.orPaste')}
          </p>

          <div>
            <Label>{t('cabinetSubmit.phones')}</Label>
            <textarea
              className="min-h-32 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-panel-elevated)] px-3 py-2 text-sm"
              value={phonesText}
              disabled={busy}
              onChange={(e) => setPhonesText(e.target.value)}
              placeholder={t('cabinetSubmit.phonesPlaceholder')}
            />
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
              {t('cabinetSubmit.numbersCount', { count: phones.length })}
            </p>
          </div>
          {estimate ? (
            <p className="text-sm">
              {t('cabinetSubmit.estimated', {
                amount: formatMoney(
                  String(estimate.estimatedSellTotal ?? '0'),
                  String(estimate.currency ?? currency),
                ),
              })}
            </p>
          ) : null}
          {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={!phones.length || busy}
              onClick={() => {
                setError(null);
                estimateMut.mutate();
              }}
            >
              {t('cabinetSubmit.estimatePrice')}
            </Button>
            <Button
              type="button"
              disabled={!phones.length || busy}
              onClick={() => {
                setError(null);
                submitMut.mutate();
              }}
            >
              {submitMut.isPending ? t('cabinetSubmit.submitting') : t('cabinetSubmit.submit')}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
