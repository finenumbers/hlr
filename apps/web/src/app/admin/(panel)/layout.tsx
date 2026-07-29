'use client';

import type { ReactNode } from 'react';

import { RequireAuth } from '@/components/auth/require-permission';
import { AppShell, type NavItem } from '@/components/layout/shell';

const nav: NavItem[] = [
  { href: '/admin', labelKey: 'nav.dashboard', permission: 'admin.access' },
  { href: '/admin/tenants', labelKey: 'nav.tenants', permission: 'admin.tenants.read' },
  { href: '/admin/tariffs', labelKey: 'nav.tariffs', permission: 'admin.billing.read' },
  { href: '/admin/jobs', labelKey: 'nav.jobs', permission: 'admin.jobs.read' },
  { href: '/admin/billing', labelKey: 'nav.billing', permission: 'admin.billing.read' },
  { href: '/admin/monitoring', labelKey: 'nav.monitoring', permission: 'admin.monitoring.read' },
  { href: '/admin/audit', labelKey: 'nav.audit', permission: 'admin.audit.read' },
  { href: '/admin/settings', labelKey: 'nav.settings', permission: 'admin.settings.read' },
];

export default function AdminPanelLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth area="admin">
      <AppShell area="admin" nav={nav}>
        {children}
      </AppShell>
    </RequireAuth>
  );
}
