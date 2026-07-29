'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

import { Can } from '@/components/auth/require-permission';
import { DataTable } from '@/components/data/data-table';
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

const createSchema = z.object({ name: z.string().min(1).max(120) });

export default function ApiKeysPage() {
  const t = useT();
  const { tenantId, can } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [rotateId, setRotateId] = useState<string | null>(null);

  const form = useForm<z.infer<typeof createSchema>>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: '' },
  });

  const q = useQuery({
    queryKey: ['cabinet', 'api-keys', tenantId, page],
    queryFn: () => api.cabinet.apiKeys(`page=${page}&pageSize=20`),
    enabled: Boolean(tenantId),
  });

  const createMut = useMutation({
    mutationFn: (name: string) => api.cabinet.createApiKey({ name }),
    onSuccess: async (data) => {
      setCreateOpen(false);
      form.reset();
      setSecret(String(data.secret ?? ''));
      await qc.invalidateQueries({ queryKey: ['cabinet', 'api-keys'] });
    },
  });
  const rotateMut = useMutation({
    mutationFn: (id: string) => api.cabinet.rotateApiKey(id),
    onSuccess: async (data) => {
      setRotateId(null);
      setSecret(String(data.secret ?? ''));
      await qc.invalidateQueries({ queryKey: ['cabinet', 'api-keys'] });
    },
  });
  const revokeMut = useMutation({
    mutationFn: (id: string) => api.cabinet.revokeApiKey(id),
    onSuccess: async () => {
      setRevokeId(null);
      await qc.invalidateQueries({ queryKey: ['cabinet', 'api-keys'] });
    },
  });

  return (
    <div>
      <PageHeader
        title={t('cabinetApiKeys.title')}
        description={t('cabinetApiKeys.description')}
        actions={
          <Can permission="cabinet.keys.manage">
            <Button type="button" onClick={() => setCreateOpen(true)}>
              {t('cabinetApiKeys.createKey')}
            </Button>
          </Can>
        }
      />
      <p className="mb-4 text-sm text-[var(--color-ink-muted)]">
        {t('cabinetApiKeys.quickstart', {
          authHeader: 'Authorization: Bearer fnk_live_…',
          path: '/v1/*',
          docs: '/docs',
        })}
      </p>
      <QueryState
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        isEmpty={!q.data?.items.length}
        emptyTitle={t('cabinetApiKeys.emptyTitle')}
        emptyDescription={
          can('cabinet.keys.manage')
            ? t('cabinetApiKeys.emptyCanManage')
            : t('cabinetApiKeys.emptyCannotManage')
        }
        onRetry={() => void q.refetch()}
      >
        <DataTable
          columns={[
            { key: 'name', header: t('cabinetApiKeys.colName'), cell: (r) => String(r.name) },
            {
              key: 'prefix',
              header: t('cabinetApiKeys.colPrefix'),
              cell: (r) => String(r.masked ?? r.prefix),
            },
            {
              key: 'status',
              header: t('cabinetApiKeys.colStatus'),
              cell: (r) => (
                <Badge tone={r.revokedAt ? 'danger' : 'ok'}>
                  {r.revokedAt ? t('cabinetApiKeys.revoked') : t('cabinetApiKeys.active')}
                </Badge>
              ),
            },
            {
              key: 'lastUsed',
              header: t('cabinetApiKeys.colLastUsed'),
              cell: (r) => formatDate(r.lastUsedAt ? String(r.lastUsedAt) : null),
            },
            {
              key: 'actions',
              header: '',
              cell: (r) =>
                can('cabinet.keys.manage') && !r.revokedAt ? (
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="secondary" onClick={() => setRotateId(String(r.id))}>
                      {t('cabinetApiKeys.rotate')}
                    </Button>
                    <Button type="button" size="sm" variant="danger" onClick={() => setRevokeId(String(r.id))}>
                      {t('cabinetApiKeys.revoke')}
                    </Button>
                  </div>
                ) : null,
            },
          ]}
          rows={(q.data?.items ?? []) as Array<Record<string, unknown>>}
          rowKey={(r) => String(r.id)}
          page={page}
          pageSize={20}
          total={q.data?.total ?? 0}
          onPageChange={setPage}
        />
      </QueryState>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title={t('cabinetApiKeys.createTitle')}>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((values) => createMut.mutate(values.name))}
        >
          <div>
            <Label htmlFor="name">{t('cabinetApiKeys.name')}</Label>
            <Input id="name" {...form.register('name')} placeholder={t('cabinetApiKeys.namePlaceholder')} />
          </div>
          <Button type="submit" disabled={createMut.isPending}>
            {createMut.isPending ? t('cabinetApiKeys.creating') : t('cabinetApiKeys.create')}
          </Button>
        </form>
      </Dialog>

      <Dialog open={Boolean(secret)} onClose={() => setSecret(null)} title={t('cabinetApiKeys.secretTitle')}>
        <p className="mb-3 text-sm text-[var(--color-warn)]">{t('cabinetApiKeys.secretWarn')}</p>
        <code className="block break-all rounded-md bg-[var(--color-panel)] p-3 text-xs">{secret}</code>
        <Button
          type="button"
          className="mt-4"
          onClick={() => {
            if (secret) void navigator.clipboard.writeText(secret);
          }}
        >
          {t('cabinetApiKeys.copy')}
        </Button>
      </Dialog>

      <ConfirmDialog
        open={Boolean(rotateId)}
        onClose={() => setRotateId(null)}
        title={t('cabinetApiKeys.rotateTitle')}
        description={t('cabinetApiKeys.rotateDesc')}
        confirmLabel={t('cabinetApiKeys.rotate')}
        loading={rotateMut.isPending}
        onConfirm={() => rotateId && rotateMut.mutate(rotateId)}
      />
      <ConfirmDialog
        open={Boolean(revokeId)}
        onClose={() => setRevokeId(null)}
        title={t('cabinetApiKeys.revokeTitle')}
        description={t('cabinetApiKeys.revokeDesc')}
        confirmLabel={t('cabinetApiKeys.revoke')}
        danger
        loading={revokeMut.isPending}
        onConfirm={() => revokeId && revokeMut.mutate(revokeId)}
      />
    </div>
  );
}
