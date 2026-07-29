'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import type { ReactNode } from 'react';

import { BrandLogo } from '@/components/layout/brand-logo';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import type { Permission } from '@/lib/auth/permissions';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

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
  const { theme, setTheme } = useTheme();
  const t = useT();

  const items = nav.filter((item) => !item.permission || can(item.permission));
  const activeHref = resolveActiveNavHref(
    pathname,
    items.map((item) => item.href),
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="border-b border-[var(--color-nav-line)] bg-[var(--color-nav)] lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-3 px-5 py-5">
          <BrandLogo variant="dark" priority />
        </div>
        <div className="px-5 pb-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] !text-white/80">
            {area === 'admin' ? t('nav.adminArea') : t('nav.cabinetArea')}
          </p>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-4 lg:flex-col">
          {items.map((item) => {
            const active = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-md px-3 py-2 text-sm whitespace-nowrap',
                  active
                    ? 'bg-[color-mix(in_oklab,var(--color-accent)_22%,transparent)] font-medium !text-[var(--color-accent)]'
                    : '!text-white hover:bg-[color-mix(in_oklab,var(--color-accent)_12%,transparent)] hover:!text-white',
                )}
              >
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>
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
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {t('common.theme')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => void logout()}>
              {t('common.logout')}
            </Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
