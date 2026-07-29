'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

import { Can } from '@/components/auth/require-permission';
import { DataTable } from '@/components/data/data-table';
import { MetricCard } from '@/components/data/metric-card';
import { PageHeader } from '@/components/data/page-header';
import { QueryState } from '@/components/data/query-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-context';
import { useT } from '@/lib/i18n';
import { formatDate } from '@/lib/utils';

const EVENTS = ['check.completed', 'check.failed', 'job.completed'] as const;

const schema = z.object({
  url: z.string().url(),
  description: z.string().optional(),
  events: z.array(z.string()).optional(),
});

export default function WebhooksPage() {
  const t = useT();
  const { tenantId, can } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [delPage, setDelPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [rotateId, setRotateId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { url: '', description: '', events: [...EVENTS] },
  });

  const endpoints = useQuery({
    queryKey: ['cabinet', 'webhooks', tenantId, page],
    queryFn: () => api.cabinet.webhooks(`page=${page}&pageSize=20`),
    enabled: Boolean(tenantId),
  });
  const summary = useQuery({
    queryKey: ['cabinet', 'webhook-summary', tenantId],
    queryFn: () => api.cabinet.webhookSummary(),
    enabled: Boolean(tenantId),
  });
  const deliveries = useQuery({
    queryKey: ['cabinet', 'deliveries', tenantId, delPage, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(delPage), pageSize: '20' });
      if (statusFilter) params.set('status', statusFilter);
      return api.cabinet.deliveries(params.toString());
    },
    enabled: Boolean(tenantId),
  });

  const createMut = useMutation({
    mutationFn: (values: z.infer<typeof schema>) =>
      api.cabinet.createWebhook({
        url: values.url,
        description: values.description,
        events: values.events,
      }),
    onSuccess: async (data) => {
      setCreateOpen(false);
      form.reset({ url: '', description: '', events: [...EVENTS] });
      setSecret(String(data.secret ?? ''));
      await qc.invalidateQueries({ queryKey: ['cabinet', 'webhooks'] });
    },
  });
  const rotateMut = useMutation({
    mutationFn: (id: string) => api.cabinet.rotateWebhook(id),
    onSuccess: async (data) => {
      setRotateId(null);
      setSecret(String(data.secret ?? ''));
    },
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.cabinet.deleteWebhook(id),
    onSuccess: async () => {
      setDeleteId(null);
      await qc.invalidateQueries({ queryKey: ['cabinet', 'webhooks'] });
    },
  });

  const counts = (summary.data?.counts as Record<string, number> | undefined) ?? {};

  return (
    <div>
      <PageHeader
        title={t('cabinetWebhooks.title')}
        description={t('cabinetWebhooks.description')}
        actions={
          <Can permission="cabinet.webhooks.manage">
            <Button type="button" onClick={() => setCreateOpen(true)}>
              {t('cabinetWebhooks.addEndpoint')}
            </Button>
          </Can>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label={t('cabinetWebhooks.succeeded')} value={counts.SUCCEEDED ?? 0} tone="ok" />
        <MetricCard label={t('cabinetWebhooks.failed')} value={counts.FAILED ?? 0} tone="warn" />
        <MetricCard label={t('cabinetWebhooks.dead')} value={counts.DEAD ?? 0} tone="danger" />
        <MetricCard
          label={t('cabinetWebhooks.pending')}
          value={(counts.PENDING ?? 0) + (counts.DELIVERING ?? 0)}
        />
      </div>

      <h2 className="mb-3 font-semibold">{t('cabinetWebhooks.endpoints')}</h2>
      <QueryState
        isLoading={endpoints.isLoading}
        isError={endpoints.isError}
        error={endpoints.error}
        isEmpty={!endpoints.data?.items.length}
        emptyTitle={t('cabinetWebhooks.emptyEndpoints')}
        onRetry={() => void endpoints.refetch()}
      >
        <DataTable
          columns={[
            {
              key: 'url',
              header: t('cabinetWebhooks.colUrl'),
              cell: (r) => <span className="break-all">{String(r.url)}</span>,
            },
            {
              key: 'events',
              header: t('cabinetWebhooks.colEvents'),
              cell: (r) =>
                ((r.events as string[] | undefined) ?? []).join(', ') || t('cabinetWebhooks.eventsAll'),
            },
            {
              key: 'enabled',
              header: t('cabinetWebhooks.colEnabled'),
              cell: (r) => (
                <Badge tone={r.enabled ? 'ok' : 'warn'}>
                  {r.enabled ? t('cabinetWebhooks.enabledYes') : t('cabinetWebhooks.enabledDisabled')}
                </Badge>
              ),
            },
            {
              key: 'failures',
              header: t('cabinetWebhooks.colFailures'),
              cell: (r) => String(r.consecutiveFailures ?? 0),
            },
            {
              key: 'actions',
              header: '',
              cell: (r) =>
                can('cabinet.webhooks.manage') ? (
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="secondary" onClick={() => setRotateId(String(r.id))}>
                      {t('cabinetWebhooks.rotateSecret')}
                    </Button>
                    <Button type="button" size="sm" variant="danger" onClick={() => setDeleteId(String(r.id))}>
                      {t('cabinetWebhooks.delete')}
                    </Button>
                  </div>
                ) : null,
            },
          ]}
          rows={(endpoints.data?.items ?? []) as Array<Record<string, unknown>>}
          rowKey={(r) => String(r.id)}
          page={page}
          pageSize={20}
          total={endpoints.data?.total ?? 0}
          onPageChange={setPage}
        />
      </QueryState>

      <div className="mt-8 mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">{t('cabinetWebhooks.deliveries')}</h2>
        <select
          className="h-9 rounded-md border border-[var(--color-line)] bg-[var(--color-panel-elevated)] px-2 text-sm"
          value={statusFilter}
          onChange={(e) => {
            setDelPage(1);
            setStatusFilter(e.target.value);
          }}
        >
          <option value="">{t('cabinetWebhooks.allStatuses')}</option>
          {['PENDING', 'DELIVERING', 'SUCCEEDED', 'FAILED', 'DEAD'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <QueryState
        isLoading={deliveries.isLoading}
        isError={deliveries.isError}
        error={deliveries.error}
        isEmpty={!deliveries.data?.items.length}
        emptyTitle={t('cabinetWebhooks.emptyDeliveries')}
      >
        <DataTable
          columns={[
            {
              key: 'when',
              header: t('cabinetWebhooks.colWhen'),
              cell: (r) => formatDate(String(r.createdAt)),
            },
            { key: 'event', header: t('cabinetWebhooks.colEvent'), cell: (r) => String(r.eventType) },
            {
              key: 'status',
              header: t('cabinetWebhooks.colStatus'),
              cell: (r) => (
                <Badge
                  tone={
                    r.status === 'SUCCEEDED'
                      ? 'ok'
                      : r.status === 'DEAD' || r.status === 'FAILED'
                        ? 'danger'
                        : 'neutral'
                  }
                >
                  {String(r.status)}
                </Badge>
              ),
            },
            {
              key: 'attempts',
              header: t('cabinetWebhooks.colAttempts'),
              cell: (r) => `${r.attemptCount ?? 0}/${r.maxAttempts ?? t('common.dash')}`,
            },
            {
              key: 'code',
              header: t('cabinetWebhooks.colHttp'),
              cell: (r) => String(r.lastResponseCode ?? t('common.dash')),
            },
          ]}
          rows={(deliveries.data?.items ?? []) as Array<Record<string, unknown>>}
          rowKey={(r) => String(r.id)}
          page={delPage}
          pageSize={20}
          total={deliveries.data?.total ?? 0}
          onPageChange={setDelPage}
        />
      </QueryState>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title={t('cabinetWebhooks.createTitle')}>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((values) => createMut.mutate(values))}
        >
          <div>
            <Label htmlFor="url">{t('cabinetWebhooks.url')}</Label>
            <Input id="url" {...form.register('url')} placeholder={t('cabinetWebhooks.urlPlaceholder')} />
          </div>
          <div>
            <Label htmlFor="description">{t('cabinetWebhooks.descriptionLabel')}</Label>
            <Input id="description" {...form.register('description')} />
          </div>
          <fieldset className="space-y-2">
            <Label>{t('cabinetWebhooks.events')}</Label>
            {EVENTS.map((event) => (
              <label key={event} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  value={event}
                  checked={(form.watch('events') ?? []).includes(event)}
                  onChange={(e) => {
                    const current = form.getValues('events') ?? [];
                    form.setValue(
                      'events',
                      e.target.checked
                        ? [...current, event]
                        : current.filter((x) => x !== event),
                    );
                  }}
                />
                {event}
              </label>
            ))}
          </fieldset>
          <Button type="submit" disabled={createMut.isPending}>
            {createMut.isPending ? t('cabinetWebhooks.creating') : t('cabinetWebhooks.create')}
          </Button>
        </form>
      </Dialog>

      <Dialog open={Boolean(secret)} onClose={() => setSecret(null)} title={t('cabinetWebhooks.secretTitle')}>
        <p className="mb-3 text-sm text-[var(--color-warn)]">{t('cabinetWebhooks.secretWarn')}</p>
        <code className="block break-all rounded-md bg-[var(--color-panel)] p-3 text-xs">{secret}</code>
        <Button
          type="button"
          className="mt-4"
          onClick={() => {
            if (secret) void navigator.clipboard.writeText(secret);
          }}
        >
          {t('cabinetWebhooks.copy')}
        </Button>
      </Dialog>

      <ConfirmDialog
        open={Boolean(rotateId)}
        onClose={() => setRotateId(null)}
        title={t('cabinetWebhooks.rotateTitle')}
        description={t('cabinetWebhooks.rotateDesc')}
        confirmLabel={t('cabinetWebhooks.rotateSecret')}
        loading={rotateMut.isPending}
        onConfirm={() => rotateId && rotateMut.mutate(rotateId)}
      />
      <ConfirmDialog
        open={Boolean(deleteId)}
        onClose={() => setDeleteId(null)}
        title={t('cabinetWebhooks.deleteTitle')}
        description={t('cabinetWebhooks.deleteDesc')}
        confirmLabel={t('cabinetWebhooks.delete')}
        danger
        loading={deleteMut.isPending}
        onConfirm={() => deleteId && deleteMut.mutate(deleteId)}
      />
    </div>
  );
}
