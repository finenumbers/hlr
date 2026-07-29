'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-context';
import { can } from '@/lib/auth/permissions';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

type FormValues = z.infer<typeof schema>;

export default function CabinetLoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: 'demo@finenumbers.local', password: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const user = await login(values.email, values.password);
      if (!can(user, 'cabinet.access')) {
        setError('This account has no tenant membership.');
        return;
      }
      router.replace('/app');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    }
  });

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <Card className="w-full max-w-md">
        <Image
          src="/branding/logo-horizontal.png"
          alt="Finenumbers"
          width={180}
          height={40}
          className="mb-4 h-9 w-auto"
        />
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold">
          Client cabinet
        </h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Sign in with your tenant account.
        </p>
        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" {...form.register('email')} />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" {...form.register('password')} />
          </div>
          {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
