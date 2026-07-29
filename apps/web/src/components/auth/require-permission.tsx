'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import type { Permission } from '@/lib/auth/permissions';
import { useT } from '@/lib/i18n';

export function RequireAuth({
  area,
  children,
}: {
  area: 'admin' | 'cabinet';
  children: ReactNode;
}) {
  const { user, loading, can } = useAuth();
  const router = useRouter();
  const t = useT();
  const loginPath = area === 'admin' ? '/admin/login' : '/app/login';
  const accessPerm: Permission = area === 'admin' ? 'admin.access' : 'cabinet.access';

  useEffect(() => {
    if (!loading && !user) {
      router.replace(loginPath);
    }
  }, [loading, user, router, loginPath]);

  if (loading) {
    return (
      <div className="p-8 text-sm text-[var(--color-ink-muted)]">{t('common.checkingSession')}</div>
    );
  }
  if (!user) return null;

  if (!can(accessPerm)) {
    return (
      <div className="mx-auto max-w-lg p-10">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold">
          {t('common.accessDeniedTitle')}
        </h1>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          {t('common.accessDeniedDescription')}
        </p>
        <div className="mt-4 flex gap-2">
          <Button type="button" variant="secondary" onClick={() => router.push(loginPath)}>
            {t('common.backToLogin')}
          </Button>
          {can('admin.access') ? (
            <Link href="/admin">
              <Button type="button">{t('common.goAdmin')}</Button>
            </Link>
          ) : null}
          {can('cabinet.access') ? (
            <Link href="/app">
              <Button type="button">{t('common.goCabinet')}</Button>
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export function RequirePermission({
  permission,
  children,
  fallback,
}: {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can } = useAuth();
  const t = useT();
  if (!can(permission)) {
    return (
      fallback ?? (
        <div className="rounded-xl border border-[var(--color-line)] p-8">
          <h2 className="text-lg font-semibold">{t('common.forbiddenTitle')}</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {t('common.forbiddenDescription', { permission })}
          </p>
        </div>
      )
    );
  }
  return <>{children}</>;
}

export function Can({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const { can } = useAuth();
  if (!can(permission)) return null;
  return <>{children}</>;
}
