'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

import { BrandLogo } from '@/components/layout/brand-logo';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-context';
import { can } from '@/lib/auth/permissions';
import { useT } from '@/lib/i18n';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

type FormValues = z.infer<typeof schema>;

export default function CabinetLoginPage() {
  const { login, logout } = useAuth();
  const router = useRouter();
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const user = await login(values.email, values.password);
      if (!can(user, 'cabinet.access')) {
        await logout();
        setError(t('auth.noMembership'));
        return;
      }
      router.replace('/app');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.loginFailed'));
    }
  });

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <Card className="w-full max-w-md">
        <div className="mb-4 flex items-start justify-between gap-3">
          <BrandLogo className="h-[2.7rem] w-auto" priority />
          <LocaleSwitcher />
        </div>
        <h1 className="text-2xl font-semibold">
          {t('auth.cabinetTitle')}
        </h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{t('auth.cabinetSubtitle')}</p>
        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div>
            <Label htmlFor="email">{t('auth.email')}</Label>
            <Input id="email" type="email" {...form.register('email')} />
          </div>
          <div>
            <Label htmlFor="password">{t('auth.password')}</Label>
            <Input id="password" type="password" {...form.register('password')} />
          </div>
          {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t('auth.signingIn') : t('auth.signIn')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
