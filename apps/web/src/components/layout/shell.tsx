'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-context';
import type { Permission } from '@/lib/auth/permissions';
import { cn } from '@/lib/utils';

export type NavItem = {
  href: string;
  label: string;
  permission?: Permission;
};

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

  const items = nav.filter((item) => !item.permission || can(item.permission));

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="border-b border-[var(--color-line)] bg-[var(--color-panel-elevated)] lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-3 px-5 py-5">
          <Image
            src="/branding/logo-horizontal.png"
            alt="Finenumbers"
            width={160}
            height={36}
            className="h-8 w-auto"
            priority
          />
        </div>
        <div className="px-5 pb-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
            {area === 'admin' ? 'Platform admin' : 'Client cabinet'}
          </p>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-4 lg:flex-col">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-md px-3 py-2 text-sm whitespace-nowrap',
                  active
                    ? 'bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]'
                    : 'text-[var(--color-ink-muted)] hover:bg-[color-mix(in_oklab,var(--color-accent)_8%,transparent)] hover:text-[var(--color-ink)]',
                )}
              >
                {item.label}
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
              {user?.platformRole ?? user?.memberships.find((m) => m.tenantId === tenantId)?.role ?? '—'}
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
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              Theme
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => void logout()}>
              Log out
            </Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
