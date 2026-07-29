'use client';

import { PageHeader } from '@/components/data/page-header';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/auth/auth-context';

export default function SettingsPage() {
  const { user, tenantId } = useAuth();
  const membership = user?.memberships.find((m) => m.tenantId === tenantId);

  return (
    <div>
      <PageHeader title="Settings" description="Profile and active tenant context." />
      <Card className="max-w-xl space-y-2 text-sm">
        <p>
          <span className="text-[var(--color-ink-muted)]">Email:</span> {user?.email}
        </p>
        <p>
          <span className="text-[var(--color-ink-muted)]">Name:</span> {user?.name ?? '—'}
        </p>
        <p>
          <span className="text-[var(--color-ink-muted)]">Role:</span> {membership?.role ?? '—'}
        </p>
        <p>
          <span className="text-[var(--color-ink-muted)]">Tenant:</span>{' '}
          {membership?.tenant.name ?? '—'} ({membership?.tenant.slug ?? '—'})
        </p>
      </Card>
    </div>
  );
}
