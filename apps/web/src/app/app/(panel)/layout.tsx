'use client';

import type { ReactNode } from 'react';

import { RequireAuth } from '@/components/auth/require-permission';
import { AppShell, type NavItem } from '@/components/layout/shell';

const nav: NavItem[] = [
  { href: '/app', label: 'Dashboard', permission: 'cabinet.access' },
  { href: '/app/submit', label: 'Submit', permission: 'cabinet.jobs.submit' },
  { href: '/app/jobs', label: 'Jobs', permission: 'cabinet.jobs.read' },
  { href: '/app/billing', label: 'Billing', permission: 'cabinet.billing.read' },
  { href: '/app/api-keys', label: 'API keys', permission: 'cabinet.access' },
  { href: '/app/webhooks', label: 'Webhooks', permission: 'cabinet.access' },
  { href: '/app/settings', label: 'Settings', permission: 'cabinet.access' },
];

export default function CabinetPanelLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth area="cabinet">
      <AppShell area="cabinet" nav={nav}>
        {children}
      </AppShell>
    </RequireAuth>
  );
}
