'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

import { PageHeader } from '@/components/data/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api/client';
import { useT } from '@/lib/i18n';
import { formatMoney } from '@/lib/utils';

const schema = z.object({
  checkType: z.enum(['HLR', 'PING']),
  phonesText: z.string(),
});

type FormValues = z.infer<typeof schema>;

export default function SubmitPage() {
  const t = useT();
  const router = useRouter();
  const [estimate, setEstimate] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { checkType: 'HLR', phonesText: '' },
  });

  const phones = useMemo(
    () =>
      form
        .watch('phonesText')
        .split(/[\n,;]+/)
        .map((p) => p.trim())
        .filter(Boolean),
    [form.watch('phonesText')],
  );

  const estimateMut = useMutation({
    mutationFn: () =>
      api.cabinet.estimate({
        checkType: form.getValues('checkType'),
        unitCount: Math.max(phones.length, 1),
      }),
    onSuccess: (data) => setEstimate(data),
    onError: (err) => setError(err instanceof ApiError ? err.message : t('cabinetSubmit.estimateFailed')),
  });

  const submitMut = useMutation({
    mutationFn: async () => {
      const values = form.getValues();
      const list = values.phonesText
        .split(/[\n,;]+/)
        .map((p) => p.trim())
        .filter(Boolean);
      if (list.length === 1) {
        return api.cabinet.submitCheck({ checkType: values.checkType, phones: list });
      }
      return api.cabinet.submitJob({ checkType: values.checkType, phones: list });
    },
    onSuccess: (job) => {
      const id =
        (job as { job?: { id?: string }; id?: string }).job?.id ??
        (job as { id?: string }).id;
      if (id) router.push(`/app/jobs/${id}`);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t('cabinetSubmit.submitFailed')),
  });

  const csvMut = useMutation({
    mutationFn: async () => {
      if (!csvFile) throw new Error('No file');
      return api.cabinet.submitJobCsv(form.getValues('checkType'), csvFile);
    },
    onSuccess: (job) => {
      const id =
        (job as { job?: { id?: string }; id?: string }).job?.id ??
        (job as { id?: string }).id;
      if (id) router.push(`/app/jobs/${id}`);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : t('cabinetSubmit.submitFailed')),
  });

  return (
    <div>
      <PageHeader
        title={t('cabinetSubmit.title')}
        description={t('cabinetSubmit.description')}
      />
      <Card className="max-w-2xl space-y-4">
        <div>
          <Label>{t('cabinetSubmit.checkType')}</Label>
          <select
            className="h-10 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-panel-elevated)] px-2 text-sm"
            {...form.register('checkType')}
          >
            <option value="HLR">{t('cabinetSubmit.optionHlr')}</option>
            <option value="PING">{t('cabinetSubmit.optionPing')}</option>
          </select>
        </div>

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

        <p className="text-center text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">
          {t('cabinetSubmit.orPaste')}
        </p>

        <div>
          <Label>{t('cabinetSubmit.phones')}</Label>
          <textarea
            className="min-h-40 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-panel-elevated)] px-3 py-2 text-sm"
            {...form.register('phonesText')}
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
                String(estimate.totalAmount ?? estimate.amount ?? '0'),
                String(estimate.currency ?? 'RUB'),
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
      </Card>
    </div>
  );
}
