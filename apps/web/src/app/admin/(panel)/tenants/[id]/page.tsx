'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Can } from '@/components/auth/require-permission';
import { PageHeader } from '@/components/data/page-header';
import { QueryState } from '@/components/data/query-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api/client';
import { useT } from '@/lib/i18n';
import { formatMoney } from '@/lib/utils';

export default function AdminTenantDetailPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [status, setStatus] = useState<string | null>(null);
  const [hlrPlanId, setHlrPlanId] = useState('');
  const [pingPlanId, setPingPlanId] = useState('');
  const [topupAmount, setTopupAmount] = useState('100');
  const [confirmTopup, setConfirmTopup] = useState(false);
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [userName, setUserName] = useState('');
  const [userRole, setUserRole] = useState<'OWNER' | 'ADMIN' | 'MEMBER'>('MEMBER');
  const [userError, setUserError] = useState<string | null>(null);
  const [rateLimitRpm, setRateLimitRpm] = useState('');
  const [maxCsvRows, setMaxCsvRows] = useState('');
  const [maxCsvBytes, setMaxCsvBytes] = useState('');
  const [maxBatchPhones, setMaxBatchPhones] = useState('');

  const q = useQuery({
    queryKey: ['admin', 'tenant', id],
    queryFn: () => api.admin.tenant(id),
  });
  const members = useQuery({
    queryKey: ['admin', 'tenant', id, 'users'],
    queryFn: () => api.admin.tenantUsers(id),
  });
  const tariffs = useQuery({
    queryKey: ['admin', 'tariffs'],
    queryFn: () => api.admin.tariffs(),
  });

  useEffect(() => {
    const tenant = q.data;
    if (!tenant) return;
    setRateLimitRpm(tenant.rateLimitRpm != null ? String(tenant.rateLimitRpm) : '');
    setMaxCsvRows(tenant.maxCsvRows != null ? String(tenant.maxCsvRows) : '');
    setMaxCsvBytes(tenant.maxCsvBytes != null ? String(tenant.maxCsvBytes) : '');
    setMaxBatchPhones(tenant.maxBatchPhones != null ? String(tenant.maxBatchPhones) : '');
  }, [q.data]);

  const statusMut = useMutation({
    mutationFn: (next: string) => api.admin.updateTenantStatus(id, next),
    onSuccess: async () => {
      setStatus(null);
      await qc.invalidateQueries({ queryKey: ['admin', 'tenant', id] });
    },
  });
  const tariffMut = useMutation({
    mutationFn: (input: { checkType: 'HLR' | 'PING'; tariffPlanId: string | null }) =>
      api.admin.assignTariff(id, input),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'tenant', id] });
    },
  });
  const topupMut = useMutation({
    mutationFn: () =>
      api.admin.topup({
        tenantId: id,
        amount: topupAmount,
        idempotencyKey: `ui-topup-${id}-${Date.now()}`,
      }),
    onSuccess: async () => {
      setConfirmTopup(false);
      await qc.invalidateQueries({ queryKey: ['admin', 'tenant', id] });
    },
  });
  const limitsMut = useMutation({
    mutationFn: () =>
      api.admin.updateTenantLimits(id, {
        rateLimitRpm: rateLimitRpm.trim() ? Number(rateLimitRpm) : null,
        maxCsvRows: maxCsvRows.trim() ? Number(maxCsvRows) : null,
        maxCsvBytes: maxCsvBytes.trim() ? Number(maxCsvBytes) : null,
        maxBatchPhones: maxBatchPhones.trim() ? Number(maxBatchPhones) : null,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'tenant', id] });
    },
  });
  const addUserMut = useMutation({
    mutationFn: () =>
      api.admin.createTenantUser(id, {
        email: userEmail.trim(),
        password: userPassword,
        name: userName.trim() || undefined,
        role: userRole,
      }),
    onSuccess: async () => {
      setAddUserOpen(false);
      setUserEmail('');
      setUserPassword('');
      setUserName('');
      setUserRole('MEMBER');
      setUserError(null);
      await qc.invalidateQueries({ queryKey: ['admin', 'tenant', id, 'users'] });
      await qc.invalidateQueries({ queryKey: ['admin', 'tenant', id] });
    },
    onError: (err) => {
      setUserError(err instanceof Error ? err.message : t('adminTenants.createError'));
    },
  });

  const tenant = q.data;
  const currency = String((tenant?.wallet as { currency?: string } | null)?.currency ?? 'RUB');

  return (
    <div>
      <PageHeader
        title={String(tenant?.name ?? t('adminTenants.title'))}
        description={String(tenant?.slug ?? id)}
        actions={
          <Link href={`/admin/audit?tenantId=${id}`}>
            <Button type="button" variant="secondary" size="sm">
              {t('adminTenants.viewAudit')}
            </Button>
          </Link>
        }
      />
      <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => void q.refetch()}>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <h2 className="font-semibold">{t('adminTenants.status')}</h2>
            <div className="mt-2">
              <Badge tone={tenant?.status === 'ACTIVE' ? 'ok' : 'warn'}>{String(tenant?.status)}</Badge>
            </div>
            <Can permission="admin.tenants.write">
              <div className="mt-4 flex gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => setStatus('SUSPENDED')}>
                  {t('adminTenants.suspend')}
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setStatus('ACTIVE')}>
                  {t('adminTenants.activate')}
                </Button>
              </div>
            </Can>
          </Card>
          <Card>
            <h2 className="font-semibold">{t('adminTenants.wallet')}</h2>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {formatMoney(
                String((tenant?.wallet as { availableBalance?: string } | null)?.availableBalance ?? '0'),
                currency,
              )}
            </p>
            <p className="text-xs text-[var(--color-ink-muted)]">
              {t('adminTenants.held', {
                amount: formatMoney(
                  String((tenant?.wallet as { heldBalance?: string } | null)?.heldBalance ?? '0'),
                  currency,
                ),
              })}
            </p>
            <Can permission="admin.billing.mutate">
              <div className="mt-4 space-y-2">
                <Label>{t('adminTenants.topupAmount')}</Label>
                <Input value={topupAmount} onChange={(e) => setTopupAmount(e.target.value)} />
                <Button type="button" size="sm" onClick={() => setConfirmTopup(true)}>
                  {t('adminTenants.topup')}
                </Button>
              </div>
            </Can>
          </Card>
          <Card className="space-y-4">
            <h2 className="font-semibold">{t('adminTenants.tariffs')}</h2>
            {(
              [
                {
                  checkType: 'HLR' as const,
                  label: t('adminTenants.assignHlr'),
                  current: (
                    tenant?.tariffs as
                      | {
                          hlr?: {
                            status?: string;
                            code?: string | null;
                            name?: string | null;
                            sellPrice?: string | null;
                            reasonMessage?: string | null;
                          } | null;
                        }
                      | undefined
                  )?.hlr,
                  value: hlrPlanId,
                  setValue: setHlrPlanId,
                },
                {
                  checkType: 'PING' as const,
                  label: t('adminTenants.assignPing'),
                  current: (
                    tenant?.tariffs as
                      | {
                          ping?: {
                            status?: string;
                            code?: string | null;
                            name?: string | null;
                            sellPrice?: string | null;
                            reasonMessage?: string | null;
                          } | null;
                        }
                      | undefined
                  )?.ping,
                  value: pingPlanId,
                  setValue: setPingPlanId,
                },
              ] as const
            ).map((slot) => (
              <div key={slot.checkType} className="rounded-md border border-[var(--color-line)] p-3">
                <p className="text-sm font-medium">{slot.label}</p>
                <p
                  className={`mt-1 text-sm ${
                    slot.current?.status === 'invalid'
                      ? 'text-[var(--color-danger)]'
                      : 'text-[var(--color-ink-muted)]'
                  }`}
                >
                  {!slot.current
                    ? t('adminTenants.notAssigned')
                    : slot.current.status === 'invalid'
                      ? t('adminTenants.tariffInvalid', {
                          code: slot.current.code ?? '—',
                          reason: slot.current.reasonMessage ?? '',
                        })
                      : `${slot.current.code} — ${slot.current.name ?? ''}${
                          slot.current.sellPrice
                            ? ` · ${formatMoney(slot.current.sellPrice, currency)}`
                            : ''
                        }`}
                </p>
                <Can permission="admin.tenants.write">
                  <div className="mt-3 flex flex-wrap gap-2">
                    <select
                      className="h-10 min-w-[12rem] flex-1 rounded-md border border-[var(--color-line)] bg-[var(--color-panel-elevated)] px-2 text-sm"
                      value={slot.value}
                      onChange={(e) => slot.setValue(e.target.value)}
                    >
                      <option value="">{t('adminTenants.select')}</option>
                      {(tariffs.data?.items ?? [])
                        .filter((plan) => plan.checkType === slot.checkType)
                        .map((plan) => (
                          <option key={String(plan.id)} value={String(plan.id)}>
                            {String(plan.code)} — {String(plan.name)}
                          </option>
                        ))}
                    </select>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!slot.value || tariffMut.isPending}
                      onClick={() =>
                        tariffMut.mutate({ checkType: slot.checkType, tariffPlanId: slot.value })
                      }
                    >
                      {t('adminTenants.assign')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={!slot.current || tariffMut.isPending}
                      onClick={() =>
                        tariffMut.mutate({ checkType: slot.checkType, tariffPlanId: null })
                      }
                    >
                      {t('adminTenants.unassign')}
                    </Button>
                  </div>
                </Can>
              </div>
            ))}
          </Card>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">{t('adminTenants.members')}</h2>
              <Can permission="admin.tenants.write">
                <Button type="button" size="sm" onClick={() => setAddUserOpen(true)}>
                  {t('adminTenants.addUser')}
                </Button>
              </Can>
            </div>
            <div className="mt-3 space-y-2">
              {(members.data?.items ?? []).length === 0 ? (
                <p className="text-sm text-[var(--color-ink-muted)]">{t('adminTenants.noMembers')}</p>
              ) : (
                (members.data?.items ?? []).map((m) => {
                  const user = m.user as {
                    id?: string;
                    email?: string;
                    name?: string | null;
                    isActive?: boolean;
                  };
                  return (
                    <div
                      key={String(m.id)}
                      className="flex items-center justify-between gap-2 border-b border-[var(--color-line)] py-2 text-sm last:border-0"
                    >
                      <div>
                        <p className="font-medium">{user.email}</p>
                        <p className="text-xs text-[var(--color-ink-muted)]">
                          {user.name || t('common.dash')} · {String(m.role)}
                        </p>
                      </div>
                      <Badge tone={user.isActive ? 'ok' : 'warn'}>
                        {user.isActive ? 'ACTIVE' : 'INACTIVE'}
                      </Badge>
                    </div>
                  );
                })
              )}
            </div>
          </Card>

          <Card>
            <h2 className="font-semibold">{t('adminTenants.limits')}</h2>
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
              {t('adminTenants.platformDefault')}
            </p>
            <Can permission="admin.tenants.write">
              <form
                className="mt-3 grid gap-3 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  limitsMut.mutate();
                }}
              >
                <div className="space-y-1">
                  <Label>{t('adminTenants.rateLimitRpm')}</Label>
                  <Input
                    value={rateLimitRpm}
                    onChange={(e) => setRateLimitRpm(e.target.value)}
                    inputMode="numeric"
                    placeholder="—"
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t('adminTenants.maxBatchPhones')}</Label>
                  <Input
                    value={maxBatchPhones}
                    onChange={(e) => setMaxBatchPhones(e.target.value)}
                    inputMode="numeric"
                    placeholder="—"
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t('adminTenants.maxCsvRows')}</Label>
                  <Input
                    value={maxCsvRows}
                    onChange={(e) => setMaxCsvRows(e.target.value)}
                    inputMode="numeric"
                    placeholder="—"
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t('adminTenants.maxCsvBytes')}</Label>
                  <Input
                    value={maxCsvBytes}
                    onChange={(e) => setMaxCsvBytes(e.target.value)}
                    inputMode="numeric"
                    placeholder="—"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit" size="sm" disabled={limitsMut.isPending}>
                    {t('adminTenants.saveLimits')}
                  </Button>
                </div>
              </form>
            </Can>
          </Card>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Card>
            <p className="text-xs uppercase text-[var(--color-ink-muted)]">{t('adminTenants.apiKeys')}</p>
            <p className="mt-1 text-2xl font-semibold">
              {String((tenant?.counts as { apiKeys?: number } | undefined)?.apiKeys ?? 0)}
            </p>
          </Card>
          <Card>
            <p className="text-xs uppercase text-[var(--color-ink-muted)]">{t('adminTenants.webhooks')}</p>
            <p className="mt-1 text-2xl font-semibold">
              {String((tenant?.counts as { webhookEndpoints?: number } | undefined)?.webhookEndpoints ?? 0)}
            </p>
          </Card>
          <Card>
            <p className="text-xs uppercase text-[var(--color-ink-muted)]">{t('adminTenants.jobs')}</p>
            <p className="mt-1 text-2xl font-semibold">
              {String((tenant?.counts as { jobs?: number } | undefined)?.jobs ?? 0)}
            </p>
            <Link href={`/admin/jobs?tenantId=${id}`} className="mt-2 inline-block text-xs text-[var(--color-accent)]">
              {t('adminTenants.openJobs')}
            </Link>
          </Card>
        </div>
      </QueryState>

      <ConfirmDialog
        open={Boolean(status)}
        onClose={() => setStatus(null)}
        title={t('adminTenants.confirmStatusTitle')}
        description={t('adminTenants.confirmStatusDesc', { status: status ?? '' })}
        confirmLabel={t('adminTenants.update')}
        loading={statusMut.isPending}
        onConfirm={() => status && statusMut.mutate(status)}
      />
      <ConfirmDialog
        open={confirmTopup}
        onClose={() => setConfirmTopup(false)}
        title={t('adminTenants.confirmTopupTitle')}
        description={t('adminTenants.confirmTopupDesc', { amount: topupAmount })}
        confirmLabel={t('adminTenants.topup')}
        loading={topupMut.isPending}
        onConfirm={() => topupMut.mutate()}
      />

      <Dialog open={addUserOpen} onClose={() => setAddUserOpen(false)} title={t('adminTenants.addUserTitle')}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setUserError(null);
            addUserMut.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="user-email">{t('adminTenants.userEmail')}</Label>
            <Input
              id="user-email"
              type="email"
              value={userEmail}
              onChange={(e) => setUserEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="user-password">{t('adminTenants.userPassword')}</Label>
            <Input
              id="user-password"
              type="password"
              value={userPassword}
              onChange={(e) => setUserPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="user-name">{t('adminTenants.userName')}</Label>
            <Input id="user-name" value={userName} onChange={(e) => setUserName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="user-role">{t('adminTenants.userRole')}</Label>
            <select
              id="user-role"
              className="h-10 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-panel-elevated)] px-2 text-sm"
              value={userRole}
              onChange={(e) => setUserRole(e.target.value as 'OWNER' | 'ADMIN' | 'MEMBER')}
            >
              <option value="OWNER">OWNER</option>
              <option value="ADMIN">ADMIN</option>
              <option value="MEMBER">MEMBER</option>
            </select>
          </div>
          {userError ? <p className="text-sm text-[var(--color-danger)]">{userError}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setAddUserOpen(false)}>
              {t('common.close')}
            </Button>
            <Button type="submit" disabled={addUserMut.isPending}>
              {t('adminTenants.addUserSubmit')}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
