'use client';

import type { ReactNode } from 'react';

import { RequireAuth } from '@/components/auth/require-permission';
import { AppShell, type NavItem } from '@/components/layout/shell';

const nav: NavItem[] = [
  { href: '/admin', label: 'Dashboard', permission: 'admin.access' },
  { href: '/admin/tenants', label: 'Tenants', permission: 'admin.tenants.read' },
  { href: '/admin/jobs', label: 'Jobs', permission: 'admin.jobs.read' },
  { href: '/admin/billing', label: 'Billing', permission: 'admin.billing.read' },
  { href: '/admin/monitoring', label: 'Monitoring', permission: 'admin.monitoring.read' },
  { href: '/admin/audit', label: 'Audit', permission: 'admin.audit.read' },
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
