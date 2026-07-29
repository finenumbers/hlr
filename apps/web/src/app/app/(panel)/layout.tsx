'use client';

import type { ReactNode } from 'react';

import { RequireAuth } from '@/components/auth/require-permission';
import { AppShell, type NavItem } from '@/components/layout/shell';

const nav: NavItem[] = [
  { href: '/app', labelKey: 'nav.dashboard', permission: 'cabinet.access' },
  { href: '/app/submit/hlr', labelKey: 'nav.submitHlr', permission: 'cabinet.jobs.submit' },
  { href: '/app/submit/ping', labelKey: 'nav.submitPing', permission: 'cabinet.jobs.submit' },
  { href: '/app/jobs', labelKey: 'nav.jobs', permission: 'cabinet.jobs.read' },
  { href: '/app/billing', labelKey: 'nav.billing', permission: 'cabinet.billing.read' },
  { href: '/app/api-keys', labelKey: 'nav.apiKeys', permission: 'cabinet.access' },
  { href: '/app/webhooks', labelKey: 'nav.webhooks', permission: 'cabinet.access' },
  { href: '/app/settings', labelKey: 'nav.settings', permission: 'cabinet.access' },
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
