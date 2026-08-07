'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { BrandLogo } from '@/components/layout/brand-logo';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-context';
import type { Permission } from '@/lib/auth/permissions';
import { useT } from '@/lib/i18n';
import { cn, formatMoney } from '@/lib/utils';

export type NavItem = {
  href: string;
  labelKey: string;
  permission?: Permission;
};

/** Longest matching href wins so `/admin` does not stay active on `/admin/audit`. */
export function resolveActiveNavHref(pathname: string, hrefs: string[]): string | null {
  const matches = hrefs.filter((href) => pathname === href || pathname.startsWith(`${href}/`));
  if (matches.length === 0) return null;
  return matches.reduce((best, href) => (href.length > best.length ? href : best));
}

export function AppShell({
  area,
  nav,
  children,
}: {
  area: 'admin' | 'cabinet';
  nav: NavItem[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { user, logout, can, tenantId, selectTenant } = useAuth();
  const t = useT();

  const items = nav.filter((item) => !item.permission || can(item.permission));
  const activeHref = resolveActiveNavHref(
    pathname,
    items.map((item) => item.href),
  );

  const balance = useQuery({
    queryKey: ['cabinet', 'balance', tenantId],
    queryFn: () => api.cabinet.balance(),
    enabled: area === 'cabinet' && Boolean(tenantId),
  });
  const balanceData = balance.data as
    | { availableBalance?: string; currency?: string }
    | undefined;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[192px_1fr]">
      <aside className="flex flex-col border-b border-[var(--color-nav-line)] bg-[var(--color-nav)] lg:min-h-screen lg:border-b-0 lg:border-r">
        <div className="flex w-full justify-center py-4">
          <BrandLogo variant="dark" priority className="mx-auto h-auto w-[90%]" />
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-4 lg:flex-1 lg:flex-col">
          {items.map((item) => {
            const active = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-md px-2.5 py-2 text-sm font-bold whitespace-nowrap',
                  active
                    ? 'bg-[var(--color-accent-bright)] !text-black'
                    : '!text-white hover:bg-[color-mix(in_oklab,var(--color-accent-bright)_18%,transparent)] hover:!text-white',
                )}
              >
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-[var(--color-nav-line)] px-2 py-3">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="w-full justify-start !text-white hover:!text-white hover:bg-[color-mix(in_oklab,var(--color-accent-bright)_18%,transparent)]"
            onClick={() => void logout()}
          >
            {t('common.logout')}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line)] bg-[color-mix(in_oklab,var(--color-panel-elevated)_80%,transparent)] px-5 py-3 backdrop-blur">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user?.email}</p>
            <p className="text-xs text-[var(--color-ink-muted)]">
              {user?.platformRole ??
                user?.memberships.find((m) => m.tenantId === tenantId)?.role ??
                t('common.dash')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {area === 'cabinet' && user && user.memberships.length > 1 ? (
              <select
                className="h-9 rounded-md border border-[var(--color-line)] bg-[var(--color-panel-elevated)] px-2 text-sm"
                value={tenantId ?? ''}
                onChange={(e) => selectTenant(e.target.value)}
              >
                {user.memberships.map((m) => (
                  <option key={m.tenantId} value={m.tenantId}>
                    {m.tenant.name}
                  </option>
                ))}
              </select>
            ) : null}
            <LocaleSwitcher />
            {area === 'cabinet' ? (
              <Link
                href="/app/billing"
                className="flex h-9 items-center rounded-md border border-transparent bg-[var(--color-accent-bright)] px-3 text-sm font-semibold tabular-nums !text-black hover:opacity-90"
              >
                {balance.isLoading
                  ? t('common.dash')
                  : formatMoney(
                      balanceData?.availableBalance ?? '0',
                      balanceData?.currency ?? 'RUB',
                    )}
              </Link>
            ) : null}
          </div>
        </header>
        <main className="w-full flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
