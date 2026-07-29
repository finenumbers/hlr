'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { Can } from '@/components/auth/require-permission';
import { DataTable } from '@/components/data/data-table';
import { PageHeader } from '@/components/data/page-header';
import { QueryState } from '@/components/data/query-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api/client';
import { useT } from '@/lib/i18n';
import { formatDate, formatMoney } from '@/lib/utils';

function LoadingFallback() {
  const t = useT();
  return <div className="p-8 text-sm text-[var(--color-ink-muted)]">{t('common.loading')}</div>;
}

function AdminTenantsPage() {
  const t = useT();
  const router = useRouter();
  const search = useSearchParams();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const status = search.get('status') ?? '';
  const q = useQuery({
    queryKey: ['admin', 'tenants', page, status],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (status) params.set('status', status);
      return api.admin.tenants(params.toString());
    },
  });

  const createMut = useMutation({
    mutationFn: () =>
      api.admin.createTenant({
        slug,
        name,
        owner:
          ownerEmail.trim() && ownerPassword
            ? {
                email: ownerEmail.trim(),
                password: ownerPassword,
                name: ownerName.trim() || undefined,
                role: 'OWNER',
              }
            : undefined,
      }),
    onSuccess: async (created) => {
      setOpen(false);
      setSlug('');
      setName('');
      setOwnerEmail('');
      setOwnerPassword('');
      setOwnerName('');
      setFormError(null);
      await qc.invalidateQueries({ queryKey: ['admin', 'tenants'] });
      if (created?.id) {
        router.push(`/admin/tenants/${String(created.id)}`);
      }
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : t('adminTenants.createError'));
    },
  });

  return (
    <div>
      <PageHeader
        title={t('adminTenants.title')}
        description={t('adminTenants.description')}
        actions={
          <Can permission="admin.tenants.write">
            <Button type="button" size="sm" onClick={() => setOpen(true)}>
              {t('adminTenants.create')}
            </Button>
          </Can>
        }
      />
      <QueryState
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        isEmpty={!q.data?.items.length}
        emptyTitle={t('adminTenants.empty')}
        onRetry={() => void q.refetch()}
      >
        <DataTable
          columns={[
            {
              key: 'name',
              header: t('adminTenants.colTenant'),
              cell: (row) => (
                <div>
                  <Link href={`/admin/tenants/${row.id}`} className="font-medium hover:underline">
                    {String(row.name)}
                  </Link>
                  <p className="text-xs text-[var(--color-ink-muted)]">{String(row.slug)}</p>
                </div>
              ),
            },
            {
              key: 'status',
              header: t('adminTenants.colStatus'),
              cell: (row) => (
                <Badge
                  tone={
                    row.status === 'ACTIVE' ? 'ok' : row.status === 'SUSPENDED' ? 'warn' : 'neutral'
                  }
                >
                  {String(row.status)}
                </Badge>
              ),
            },
            {
              key: 'balance',
              header: t('adminTenants.colAvailable'),
              cell: (row) => {
                const w = row.wallet as { availableBalance?: string; currency?: string } | null;
                return w ? formatMoney(w.availableBalance ?? '0', w.currency) : t('common.dash');
              },
            },
            {
              key: 'tariff',
              header: t('adminTenants.colTariff'),
              cell: (row) => {
                const tariffs = row.tariffs as {
                  hlr?: { code?: string } | null;
                  ping?: { code?: string } | null;
                } | null;
                const hlr = tariffs?.hlr?.code;
                const ping = tariffs?.ping?.code;
                if (!hlr && !ping) return t('common.dash');
                return `HLR: ${hlr ?? '—'} · Ping: ${ping ?? '—'}`;
              },
            },
            {
              key: 'created',
              header: t('adminTenants.colCreated'),
              cell: (row) => formatDate(String(row.createdAt)),
            },
          ]}
          rows={(q.data?.items ?? []) as Array<Record<string, unknown>>}
          rowKey={(row) => String(row.id)}
          page={page}
          pageSize={20}
          total={q.data?.total ?? 0}
          onPageChange={setPage}
        />
      </QueryState>

      <Dialog open={open} onClose={() => setOpen(false)} title={t('adminTenants.createTitle')}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setFormError(null);
            createMut.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="tenant-slug">{t('adminTenants.slug')}</Label>
            <Input
              id="tenant-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              pattern="[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tenant-name">{t('adminTenants.name')}</Label>
            <Input
              id="tenant-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="owner-email">{t('adminTenants.ownerEmail')}</Label>
            <Input
              id="owner-email"
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="owner-password">{t('adminTenants.ownerPassword')}</Label>
            <Input
              id="owner-password"
              type="password"
              value={ownerPassword}
              onChange={(e) => setOwnerPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="owner-name">{t('adminTenants.ownerName')}</Label>
            <Input
              id="owner-name"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
            />
          </div>
          {formError ? <p className="text-sm text-[var(--color-danger)]">{formError}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('common.close')}
            </Button>
            <Button type="submit" disabled={createMut.isPending}>
              {t('adminTenants.createSubmit')}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <AdminTenantsPage />
    </Suspense>
  );
}
