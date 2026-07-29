'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Can } from '@/components/auth/require-permission';
import { DataTable } from '@/components/data/data-table';
import { PageHeader } from '@/components/data/page-header';
import { QueryState } from '@/components/data/query-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api/client';
import { useT } from '@/lib/i18n';
import { formatMoney } from '@/lib/utils';

type TariffForm = {
  code: string;
  name: string;
  checkType: 'HLR' | 'PING';
  currency: string;
  sellPrice: string;
  providerCost: string;
  isDefault: boolean;
  isActive: boolean;
  description: string;
};

const emptyForm: TariffForm = {
  code: '',
  name: '',
  checkType: 'HLR',
  currency: 'RUB',
  sellPrice: '0.15',
  providerCost: '0.05',
  isDefault: false,
  isActive: true,
  description: '',
};

export default function AdminTariffsPage() {
  const t = useT();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TariffForm>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['admin', 'tariffs', page],
    queryFn: () => api.admin.tariffs(`page=${page}&pageSize=20`),
  });

  const createMut = useMutation({
    mutationFn: () =>
      api.admin.createTariff({
        code: form.code.trim(),
        name: form.name.trim(),
        checkType: form.checkType,
        currency: form.currency.trim().toUpperCase(),
        sellPrice: form.sellPrice,
        providerCost: form.providerCost,
        isDefault: form.isDefault,
        isActive: form.isActive,
        description: form.description.trim() || undefined,
      }),
    onSuccess: async () => {
      setError(null);
      setForm(emptyForm);
      setEditingId(null);
      await qc.invalidateQueries({ queryKey: ['admin', 'tariffs'] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : t('adminTariffs.createFailed'));
    },
  });

  const updateMut = useMutation({
    mutationFn: () => {
      if (!editingId) throw new Error('No tariff selected');
      return api.admin.updateTariff(editingId, {
        name: form.name.trim(),
        currency: form.currency.trim().toUpperCase(),
        sellPrice: form.sellPrice,
        providerCost: form.providerCost,
        isDefault: form.isDefault,
        isActive: form.isActive,
        description: form.description.trim() || null,
      });
    },
    onSuccess: async () => {
      setError(null);
      setForm(emptyForm);
      setEditingId(null);
      await qc.invalidateQueries({ queryKey: ['admin', 'tariffs'] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : t('adminTariffs.updateFailed'));
    },
  });

  const startEdit = (row: Record<string, unknown>) => {
    setEditingId(String(row.id));
    setError(null);
    setForm({
      code: String(row.code ?? ''),
      name: String(row.name ?? ''),
      checkType: row.checkType === 'PING' ? 'PING' : 'HLR',
      currency: String(row.currency ?? 'RUB'),
      sellPrice: String(row.sellPrice ?? '0'),
      providerCost: String(row.providerCost ?? '0'),
      isDefault: Boolean(row.isDefault),
      isActive: row.isActive !== false,
      description: String(row.description ?? ''),
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
  };

  const saving = createMut.isPending || updateMut.isPending;

  return (
    <div>
      <PageHeader title={t('adminTariffs.title')} description={t('adminTariffs.description')} />

      <Can permission="admin.billing.mutate">
        <Card className="mb-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              {editingId
                ? t('adminTariffs.editTitle', { code: form.code })
                : t('adminTariffs.createTitle')}
            </h2>
            {editingId ? (
              <Button type="button" size="sm" variant="ghost" onClick={cancelEdit}>
                {t('adminTariffs.cancelEdit')}
              </Button>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label htmlFor="code">{t('adminTariffs.code')}</Label>
              <Input
                id="code"
                value={form.code}
                disabled={Boolean(editingId)}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                placeholder={t('adminTariffs.codePlaceholder')}
              />
            </div>
            <div>
              <Label htmlFor="name">{t('adminTariffs.name')}</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t('adminTariffs.namePlaceholder')}
              />
            </div>
            <div>
              <Label htmlFor="checkType">{t('adminTariffs.checkType')}</Label>
              <select
                id="checkType"
                className="h-10 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-panel-elevated)] px-2 text-sm"
                value={form.checkType}
                disabled={Boolean(editingId)}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    checkType: e.target.value === 'PING' ? 'PING' : 'HLR',
                  }))
                }
              >
                <option value="HLR">HLR</option>
                <option value="PING">Ping-SMS</option>
              </select>
            </div>
            <div>
              <Label htmlFor="currency">{t('adminTariffs.currency')}</Label>
              <Input
                id="currency"
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="sellPrice">{t('adminTariffs.sellPrice')}</Label>
              <Input
                id="sellPrice"
                value={form.sellPrice}
                onChange={(e) => setForm((f) => ({ ...f, sellPrice: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="providerCost">{t('adminTariffs.providerCost')}</Label>
              <Input
                id="providerCost"
                value={form.providerCost}
                onChange={(e) => setForm((f) => ({ ...f, providerCost: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="description">{t('adminTariffs.descriptionLabel')}</Label>
              <Input
                id="description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
              />
              {t('adminTariffs.defaultPlan')}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              />
              {t('adminTariffs.active')}
            </label>
          </div>
          {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
          <Button
            type="button"
            disabled={saving || !form.code.trim() || !form.name.trim()}
            onClick={() => (editingId ? updateMut.mutate() : createMut.mutate())}
          >
            {saving
              ? t('adminTariffs.saving')
              : editingId
                ? t('adminTariffs.save')
                : t('adminTariffs.create')}
          </Button>
        </Card>
      </Can>

      <QueryState
        isLoading={list.isLoading}
        isError={list.isError}
        error={list.error}
        isEmpty={!list.data?.items.length}
        emptyTitle={t('adminTariffs.emptyTitle')}
        emptyDescription={t('adminTariffs.emptyDescription')}
        onRetry={() => void list.refetch()}
      >
        <DataTable
          columns={[
            {
              key: 'code',
              header: t('adminTariffs.colPlan'),
              cell: (row) => (
                <div>
                  <p className="font-medium">{String(row.code)}</p>
                  <p className="text-xs text-[var(--color-ink-muted)]">{String(row.name)}</p>
                </div>
              ),
            },
            {
              key: 'checkType',
              header: t('adminTariffs.colType'),
              cell: (row) => String(row.checkType),
            },
            {
              key: 'sell',
              header: t('adminTariffs.colSell'),
              cell: (row) =>
                formatMoney(String(row.sellPrice), String(row.currency ?? 'RUB')),
            },
            {
              key: 'cost',
              header: t('adminTariffs.colProviderCost'),
              cell: (row) =>
                formatMoney(String(row.providerCost ?? 0), String(row.currency ?? 'RUB')),
            },
            {
              key: 'flags',
              header: t('adminTariffs.colFlags'),
              cell: (row) => (
                <div className="flex flex-wrap gap-1">
                  {row.isDefault ? <Badge tone="accent">{t('adminTariffs.badgeDefault')}</Badge> : null}
                  <Badge tone={row.isActive ? 'ok' : 'danger'}>
                    {row.isActive ? t('adminTariffs.badgeActive') : t('adminTariffs.badgeInactive')}
                  </Badge>
                </div>
              ),
            },
            {
              key: 'actions',
              header: '',
              cell: (row) => (
                <Can permission="admin.billing.mutate">
                  <Button type="button" size="sm" variant="secondary" onClick={() => startEdit(row)}>
                    {t('adminTariffs.edit')}
                  </Button>
                </Can>
              ),
            },
          ]}
          rows={list.data?.items ?? []}
          rowKey={(row) => String(row.id)}
          page={page}
          pageSize={list.data?.pageSize ?? 20}
          total={list.data?.total ?? 0}
          onPageChange={setPage}
        />
      </QueryState>
    </div>
  );
}
