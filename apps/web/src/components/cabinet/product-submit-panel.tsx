'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api/client';
import type { CheckType } from '@/lib/check-type';
import { useT } from '@/lib/i18n';
import { formatMoney } from '@/lib/utils';

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
  const [phonesText, setPhonesText] = useState('');
  const [estimate, setEstimate] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);

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

  const csvMut = useMutation({
    mutationFn: async () => {
      if (!csvFile) throw new Error('No file');
      return api.cabinet.submitJobCsv(checkType, csvFile);
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
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="mt-1 block w-full text-sm"
              onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
            />
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{t('cabinetSubmit.csvHint')}</p>
            <div className="mt-2">
              <Button
                type="button"
                disabled={!csvFile || csvMut.isPending}
                onClick={() => {
                  setError(null);
                  csvMut.mutate();
                }}
              >
                {csvMut.isPending ? t('cabinetSubmit.submitting') : t('cabinetSubmit.submitCsv')}
              </Button>
            </div>
          </div>

          <p className="text-center text-xs font-bold text-[var(--color-ink-muted)]">
            {t('cabinetSubmit.orPaste')}
          </p>

          <div>
            <Label>{t('cabinetSubmit.phones')}</Label>
            <textarea
              className="min-h-32 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-panel-elevated)] px-3 py-2 text-sm"
              value={phonesText}
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
              disabled={!phones.length || estimateMut.isPending}
              onClick={() => {
                setError(null);
                estimateMut.mutate();
              }}
            >
              {t('cabinetSubmit.estimatePrice')}
            </Button>
            <Button
              type="button"
              disabled={!phones.length || submitMut.isPending}
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
