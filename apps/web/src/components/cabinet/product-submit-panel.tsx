'use client';

import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api/client';
import type { CheckType } from '@/lib/check-type';
import { useT } from '@/lib/i18n';
import { cn, formatMoney } from '@/lib/utils';

const PHONE_PAGE_SIZE = 100;

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

function formatCsvApiError(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;
  return err.code ? `${err.message} (${err.code})` : err.message;
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
  const phoneScrollRef = useRef<HTMLDivElement>(null);
  const phoneLoadMoreRef = useRef<HTMLDivElement>(null);
  const previewIdRef = useRef<string | null>(null);
  const submittedPreviewIdRef = useRef<string | null>(null);
  const [phonesText, setPhonesText] = useState('');
  const [estimate, setEstimate] = useState<Record<string, unknown> | null>(null);
  const [csvEstimate, setCsvEstimate] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    previewIdRef.current = preview?.id ?? null;
  }, [preview?.id]);

  /** Drop server-side preview when it leaves the screen (not after successful submit). */
  const discardActivePreview = (id: string | null | undefined, keepalive = false) => {
    if (!id || id === submittedPreviewIdRef.current) return;
    void api.cabinet.discardCsvPreview(id, { keepalive }).catch(() => {
      // best-effort — TTL also expires unused rows
    });
  };

  useEffect(() => {
    return () => {
      const id = previewIdRef.current;
      if (!id || id === submittedPreviewIdRef.current) return;
      void api.cabinet.discardCsvPreview(id, { keepalive: true }).catch(() => {
        // best-effort — TTL also expires unused rows
      });
    };
  }, []);

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

  const phonesQuery = useInfiniteQuery({
    queryKey: ['cabinet', 'csv-preview-phones', preview?.id, PHONE_PAGE_SIZE],
    queryFn: ({ pageParam }) =>
      api.cabinet.csvPreviewPhones(preview!.id, pageParam, PHONE_PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (last) => {
      if (last.page * last.pageSize >= last.total) return undefined;
      return last.page + 1;
    },
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
      setCsvEstimate(null);
      setCsvError(null);
    },
    onError: (err) => setCsvError(formatCsvApiError(err, t('cabinetSubmit.submitFailed'))),
  });

  const csvEstimateMut = useMutation({
    mutationFn: async () => {
      if (!preview?.id) throw new Error('No preview');
      return api.cabinet.estimateCsvPreview(preview.id);
    },
    onSuccess: (data) => setCsvEstimate(data),
    onError: (err) => setCsvError(formatCsvApiError(err, t('cabinetSubmit.estimateFailed'))),
  });

  const csvSubmitMut = useMutation({
    mutationFn: async () => {
      if (!preview?.id) throw new Error('No preview');
      return api.cabinet.submitCsvPreview(preview.id);
    },
    onSuccess: (job) => {
      if (preview?.id) {
        submittedPreviewIdRef.current = preview.id;
      }
      const id =
        (job as { job?: { id?: string }; id?: string }).job?.id ??
        (job as { id?: string }).id;
      if (id) router.push(`/app/jobs/${id}`);
    },
    onError: (err) => setCsvError(formatCsvApiError(err, t('cabinetSubmit.submitFailed'))),
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
    discardActivePreview(previewIdRef.current);
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
    phonesQuery.data?.pages.flatMap((page) => page.items) ??
    preview?.phones.items ??
    [];
  const phoneTotal =
    phonesQuery.data?.pages[0]?.total ?? preview?.phones.total ?? 0;

  useEffect(() => {
    const root = phoneScrollRef.current;
    const target = phoneLoadMoreRef.current;
    if (!root || !target || preview?.status !== 'READY') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0]?.isIntersecting &&
          phonesQuery.hasNextPage &&
          !phonesQuery.isFetchingNextPage
        ) {
          void phonesQuery.fetchNextPage();
        }
      },
      { root, rootMargin: '120px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [
    preview?.id,
    preview?.status,
    phoneItems.length,
    phonesQuery.hasNextPage,
    phonesQuery.isFetchingNextPage,
    phonesQuery.fetchNextPage,
  ]);

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
                    <div
                      ref={phoneScrollRef}
                      className="max-h-64 overflow-auto rounded border border-[var(--color-line)] bg-[var(--color-panel-elevated)]"
                    >
                      <ol className="space-y-0.5 px-3 py-2 text-sm">
                        {phoneItems.map((phone, idx) => {
                          const n = idx + 1;
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
                      <div ref={phoneLoadMoreRef} className="h-1" aria-hidden />
                      {phonesQuery.isFetchingNextPage ? (
                        <p className="px-3 pb-2 text-xs text-[var(--color-ink-muted)]">
                          {t('cabinetSubmit.loadingMorePhones')}
                        </p>
                      ) : null}
                    </div>
                    {phoneTotal > 0 ? (
                      <p className="text-xs text-[var(--color-ink-muted)]">
                        {t('cabinetSubmit.previewShown', {
                          loaded: phoneItems.length,
                          total: phoneTotal,
                        })}
                      </p>
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
