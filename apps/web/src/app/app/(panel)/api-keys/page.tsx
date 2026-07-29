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
import { formatDate } from '@/lib/utils';

const createSchema = z.object({ name: z.string().min(1).max(120) });

export default function ApiKeysPage() {
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
        title="API keys"
        description="Manage public API credentials. Secrets are shown once."
        actions={
          <Can permission="cabinet.keys.manage">
            <Button type="button" onClick={() => setCreateOpen(true)}>
              Create key
            </Button>
          </Can>
        }
      />
      <p className="mb-4 text-sm text-[var(--color-ink-muted)]">
        Quickstart: use{' '}
        <code className="rounded bg-[var(--color-panel)] px-1">Authorization: Bearer fnk_live_…</code>{' '}
        against <code className="rounded bg-[var(--color-panel)] px-1">/v1/*</code>. See API docs at{' '}
        <a className="text-[var(--color-accent)] underline" href="http://localhost:3001/docs" target="_blank" rel="noreferrer">
          /docs
        </a>
        .
      </p>
      <QueryState
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        isEmpty={!q.data?.items.length}
        emptyTitle="No API keys"
        emptyDescription={can('cabinet.keys.manage') ? 'Create a key for your backend integration.' : 'Ask an owner/admin to create a key.'}
        onRetry={() => void q.refetch()}
      >
        <DataTable
          columns={[
            { key: 'name', header: 'Name', cell: (r) => String(r.name) },
            { key: 'prefix', header: 'Prefix', cell: (r) => String(r.masked ?? r.prefix) },
            {
              key: 'status',
              header: 'Status',
              cell: (r) => (
                <Badge tone={r.revokedAt ? 'danger' : 'ok'}>{r.revokedAt ? 'revoked' : 'active'}</Badge>
              ),
            },
            {
              key: 'lastUsed',
              header: 'Last used',
              cell: (r) => formatDate(r.lastUsedAt ? String(r.lastUsedAt) : null),
            },
            {
              key: 'actions',
              header: '',
              cell: (r) =>
                can('cabinet.keys.manage') && !r.revokedAt ? (
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="secondary" onClick={() => setRotateId(String(r.id))}>
                      Rotate
                    </Button>
                    <Button type="button" size="sm" variant="danger" onClick={() => setRevokeId(String(r.id))}>
                      Revoke
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

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="Create API key">
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((values) => createMut.mutate(values.name))}
        >
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" {...form.register('name')} placeholder="Production backend" />
          </div>
          <Button type="submit" disabled={createMut.isPending}>
            {createMut.isPending ? 'Creating…' : 'Create'}
          </Button>
        </form>
      </Dialog>

      <Dialog open={Boolean(secret)} onClose={() => setSecret(null)} title="Copy secret now">
        <p className="mb-3 text-sm text-[var(--color-warn)]">
          This secret is shown once. Store it securely — it cannot be retrieved again.
        </p>
        <code className="block break-all rounded-md bg-[var(--color-panel)] p-3 text-xs">{secret}</code>
        <Button
          type="button"
          className="mt-4"
          onClick={() => {
            if (secret) void navigator.clipboard.writeText(secret);
          }}
        >
          Copy to clipboard
        </Button>
      </Dialog>

      <ConfirmDialog
        open={Boolean(rotateId)}
        onClose={() => setRotateId(null)}
        title="Rotate API key?"
        description="The previous secret will stop working immediately. A new secret is shown once."
        confirmLabel="Rotate"
        loading={rotateMut.isPending}
        onConfirm={() => rotateId && rotateMut.mutate(rotateId)}
      />
      <ConfirmDialog
        open={Boolean(revokeId)}
        onClose={() => setRevokeId(null)}
        title="Revoke API key?"
        description="This key will no longer authenticate. This cannot be undone."
        confirmLabel="Revoke"
        danger
        loading={revokeMut.isPending}
        onConfirm={() => revokeId && revokeMut.mutate(revokeId)}
      />
    </div>
  );
}
