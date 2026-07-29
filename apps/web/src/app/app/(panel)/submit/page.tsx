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
import { formatMoney } from '@/lib/utils';

const schema = z.object({
  checkType: z.enum(['HLR', 'PING']),
  phonesText: z.string().min(3),
});

type FormValues = z.infer<typeof schema>;

export default function SubmitPage() {
  const router = useRouter();
  const [estimate, setEstimate] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Estimate failed'),
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
      const id = (job as { id?: string }).id;
      if (id) router.push(`/app/jobs/${id}`);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Submit failed'),
  });

  return (
    <div>
      <PageHeader
        title="Submit"
        description="Single HLR/Ping or bulk paste. Pre-check estimated price before send."
      />
      <Card className="max-w-2xl space-y-4">
        <div>
          <Label>Check type</Label>
          <select
            className="h-10 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-panel-elevated)] px-2 text-sm"
            {...form.register('checkType')}
          >
            <option value="HLR">HLR</option>
            <option value="PING">Ping-SMS</option>
          </select>
        </div>
        <div>
          <Label>Phone numbers (E.164, one per line or comma-separated)</Label>
          <textarea
            className="min-h-40 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-panel-elevated)] px-3 py-2 text-sm"
            {...form.register('phonesText')}
            placeholder="+79991234567"
          />
          <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{phones.length} numbers</p>
        </div>
        {estimate ? (
          <p className="text-sm">
            Estimated:{' '}
            <strong>
              {formatMoney(String(estimate.totalAmount ?? estimate.amount ?? '0'), String(estimate.currency ?? 'RUB'))}
            </strong>
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
            Estimate price
          </Button>
          <Button
            type="button"
            disabled={!phones.length || submitMut.isPending}
            onClick={() => {
              setError(null);
              submitMut.mutate();
            }}
          >
            {submitMut.isPending ? 'Submitting…' : 'Submit'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
