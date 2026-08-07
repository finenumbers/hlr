'use client';

import { PageHeader } from '@/components/data/page-header';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/auth/auth-context';
import { useT } from '@/lib/i18n';

export default function SettingsPage() {
  const t = useT();
  const { user, tenantId } = useAuth();
  const membership = user?.memberships.find((m) => m.tenantId === tenantId);

  return (
    <div>
      <PageHeader title={t('cabinetSettings.title')} description={t('cabinetSettings.description')} />
      <Card className="w-full space-y-2 text-sm">
        <p>
          <span className="text-[var(--color-ink-muted)]">{t('cabinetSettings.email')}</span> {user?.email}
        </p>
        <p>
          <span className="text-[var(--color-ink-muted)]">{t('cabinetSettings.name')}</span>{' '}
          {user?.name ?? t('common.dash')}
        </p>
        <p>
          <span className="text-[var(--color-ink-muted)]">{t('cabinetSettings.role')}</span>{' '}
          {membership?.role ?? t('common.dash')}
        </p>
        <p>
          <span className="text-[var(--color-ink-muted)]">{t('cabinetSettings.tenant')}</span>{' '}
          {membership?.tenant.name ?? t('common.dash')} ({membership?.tenant.slug ?? t('common.dash')})
        </p>
      </Card>
    </div>
  );
}
