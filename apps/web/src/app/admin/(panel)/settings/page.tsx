'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ChangeEvent } from 'react';

import { Can } from '@/components/auth/require-permission';
import { PageHeader } from '@/components/data/page-header';
import { QueryState } from '@/components/data/query-state';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-context';
import { useI18n, useT } from '@/lib/i18n';
import { formatDate } from '@/lib/utils';

type SettingsForm = {
  currency: string;
  defaultRateLimitRpm: string;
  maxCsvRows: string;
  maxCsvBytes: string;
  maxBatchPhones: string;
  checkTimeoutSec: string;
  pollIntervalSec: string;
  webhookMaxAttempts: string;
  webhookTimeoutMs: string;
  retentionDays: string;
  smscBaseUrl: string;
  extrasText: string;
};

const emptyForm: SettingsForm = {
  currency: 'RUB',
  defaultRateLimitRpm: '60',
  maxCsvRows: '100000',
  maxCsvBytes: '52428800',
  maxBatchPhones: '1000',
  checkTimeoutSec: '3600',
  pollIntervalSec: '30',
  webhookMaxAttempts: '8',
  webhookTimeoutMs: '5000',
  retentionDays: '90',
  smscBaseUrl: '',
  extrasText: '',
};

function toForm(data: Record<string, unknown>): SettingsForm {
  return {
    currency: String(data.currency ?? 'RUB'),
    defaultRateLimitRpm: String(data.defaultRateLimitRpm ?? 60),
    maxCsvRows: String(data.maxCsvRows ?? 100000),
    maxCsvBytes: String(data.maxCsvBytes ?? 52428800),
    maxBatchPhones: String(data.maxBatchPhones ?? 1000),
    checkTimeoutSec: String(data.checkTimeoutSec ?? 3600),
    pollIntervalSec: String(data.pollIntervalSec ?? 30),
    webhookMaxAttempts: String(data.webhookMaxAttempts ?? 8),
    webhookTimeoutMs: String(data.webhookTimeoutMs ?? 5000),
    retentionDays: String(data.retentionDays ?? 90),
    smscBaseUrl: data.smscBaseUrl ? String(data.smscBaseUrl) : '',
    extrasText:
      data.extras && typeof data.extras === 'object'
        ? JSON.stringify(data.extras, null, 2)
        : '',
  };
}

export default function AdminSettingsPage() {
  const t = useT();
  const { locale } = useI18n();
  const { can } = useAuth();
  const qc = useQueryClient();
  const canWrite = can('admin.settings.write');
  const [form, setForm] = useState<SettingsForm>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const q = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api.admin.settings(),
  });

  useEffect(() => {
    if (q.data) setForm(toForm(q.data));
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => {
      let extras: Record<string, unknown> | null | undefined;
      const trimmed = form.extrasText.trim();
      if (!trimmed) {
        extras = null;
      } else {
        try {
          const parsed: unknown = JSON.parse(trimmed);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error(t('adminSettings.extrasInvalid'));
          }
          extras = parsed as Record<string, unknown>;
        } catch {
          throw new ApiError(t('adminSettings.extrasInvalid'), 400);
        }
      }

      return api.admin.updateSettings({
        currency: form.currency.trim().toUpperCase(),
        defaultRateLimitRpm: Number(form.defaultRateLimitRpm),
        maxCsvRows: Number(form.maxCsvRows),
        maxCsvBytes: Number(form.maxCsvBytes),
        maxBatchPhones: Number(form.maxBatchPhones),
        checkTimeoutSec: Number(form.checkTimeoutSec),
        pollIntervalSec: Number(form.pollIntervalSec),
        webhookMaxAttempts: Number(form.webhookMaxAttempts),
        webhookTimeoutMs: Number(form.webhookTimeoutMs),
        retentionDays: Number(form.retentionDays),
        smscBaseUrl: form.smscBaseUrl.trim() || null,
        extras,
      });
    },
    onSuccess: async () => {
      setConfirmOpen(false);
      setError(null);
      await qc.invalidateQueries({ queryKey: ['admin', 'settings'] });
    },
    onError: (err) => {
      setConfirmOpen(false);
      setError(err instanceof ApiError ? err.message : t('adminSettings.saveFailed'));
    },
  });

  const setField =
    (key: keyof SettingsForm) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((prev) => ({ ...prev, [key]: e.target.value }));
    };

  return (
    <div>
      <PageHeader title={t('adminSettings.title')} description={t('adminSettings.description')} />

      <QueryState
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        onRetry={() => void q.refetch()}
      >
        <div className="space-y-4">
          <Card className="space-y-2 border-[color-mix(in_oklab,var(--color-warn)_35%,var(--color-line))] bg-[color-mix(in_oklab,var(--color-warn)_8%,transparent)]">
            <p className="text-sm">{t('adminSettings.secretsNote')}</p>
            {!canWrite ? (
              <p className="text-sm text-[var(--color-ink-muted)]">{t('adminSettings.readOnly')}</p>
            ) : null}
            {q.data?.updatedAt ? (
              <p className="text-xs text-[var(--color-ink-muted)]">
                {t('adminSettings.updatedAt', {
                  when: formatDate(String(q.data.updatedAt), locale),
                })}
              </p>
            ) : null}
          </Card>

          <Card className="space-y-4">
            <h2 className="text-sm font-semibold">{t('adminSettings.sectionLimits')}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field
                id="currency"
                label={t('adminSettings.currency')}
                value={form.currency}
                onChange={setField('currency')}
                disabled={!canWrite}
              />
              <Field
                id="defaultRateLimitRpm"
                label={t('adminSettings.defaultRateLimitRpm')}
                value={form.defaultRateLimitRpm}
                onChange={setField('defaultRateLimitRpm')}
                disabled={!canWrite}
              />
              <Field
                id="maxBatchPhones"
                label={t('adminSettings.maxBatchPhones')}
                value={form.maxBatchPhones}
                onChange={setField('maxBatchPhones')}
                disabled={!canWrite}
              />
              <Field
                id="maxCsvRows"
                label={t('adminSettings.maxCsvRows')}
                value={form.maxCsvRows}
                onChange={setField('maxCsvRows')}
                disabled={!canWrite}
              />
              <Field
                id="maxCsvBytes"
                label={t('adminSettings.maxCsvBytes')}
                value={form.maxCsvBytes}
                onChange={setField('maxCsvBytes')}
                disabled={!canWrite}
              />
            </div>
          </Card>

          <Card className="space-y-4">
            <h2 className="text-sm font-semibold">{t('adminSettings.sectionTimeouts')}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                id="checkTimeoutSec"
                label={t('adminSettings.checkTimeoutSec')}
                value={form.checkTimeoutSec}
                onChange={setField('checkTimeoutSec')}
                disabled={!canWrite}
              />
              <Field
                id="pollIntervalSec"
                label={t('adminSettings.pollIntervalSec')}
                value={form.pollIntervalSec}
                onChange={setField('pollIntervalSec')}
                disabled={!canWrite}
              />
            </div>
          </Card>

          <Card className="space-y-4">
            <h2 className="text-sm font-semibold">{t('adminSettings.sectionWebhooks')}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                id="webhookMaxAttempts"
                label={t('adminSettings.webhookMaxAttempts')}
                value={form.webhookMaxAttempts}
                onChange={setField('webhookMaxAttempts')}
                disabled={!canWrite}
              />
              <Field
                id="webhookTimeoutMs"
                label={t('adminSettings.webhookTimeoutMs')}
                value={form.webhookTimeoutMs}
                onChange={setField('webhookTimeoutMs')}
                disabled={!canWrite}
              />
            </div>
          </Card>

          <Card className="space-y-4">
            <h2 className="text-sm font-semibold">{t('adminSettings.sectionRetention')}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                id="retentionDays"
                label={t('adminSettings.retentionDays')}
                value={form.retentionDays}
                onChange={setField('retentionDays')}
                disabled={!canWrite}
              />
              <div>
                <Label htmlFor="smscBaseUrl">{t('adminSettings.smscBaseUrl')}</Label>
                <Input
                  id="smscBaseUrl"
                  value={form.smscBaseUrl}
                  onChange={setField('smscBaseUrl')}
                  disabled={!canWrite}
                  placeholder="https://smsc.ru"
                />
                <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                  {t('adminSettings.smscBaseUrlHint')}
                </p>
              </div>
            </div>
            <div>
              <Label htmlFor="extras">{t('adminSettings.extras')}</Label>
              <textarea
                id="extras"
                className="min-h-28 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-panel-elevated)] px-3 py-2 font-mono text-sm"
                value={form.extrasText}
                onChange={setField('extrasText')}
                disabled={!canWrite}
                spellCheck={false}
              />
              <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                {t('adminSettings.extrasHint')}
              </p>
            </div>
          </Card>

          {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}

          <Can permission="admin.settings.write">
            <Button type="button" disabled={save.isPending} onClick={() => setConfirmOpen(true)}>
              {save.isPending ? t('adminSettings.saving') : t('adminSettings.save')}
            </Button>
          </Can>
        </div>
      </QueryState>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => save.mutate()}
        title={t('adminSettings.confirmTitle')}
        description={t('adminSettings.confirmDesc')}
        confirmLabel={t('adminSettings.confirm')}
        loading={save.isPending}
      />
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={onChange} disabled={disabled} />
    </div>
  );
}
