'use client';

import { Button } from '@/components/ui/button';
import { useI18n, type Locale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const OPTIONS: { value: Locale; label: string }[] = [
  { value: 'ru', label: 'RU' },
  { value: 'en', label: 'EN' },
];

export function LocaleSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();

  return (
    <div
      className={cn(
        'inline-flex h-9 items-center rounded-md border border-[var(--color-line)] bg-[var(--color-panel-elevated)] p-0.5',
        className,
      )}
      role="group"
      aria-label={t('common.language')}
    >
      {OPTIONS.map((opt) => (
        <Button
          key={opt.value}
          type="button"
          size="sm"
          variant={locale === opt.value ? 'secondary' : 'ghost'}
          className={cn(
            'h-8 min-w-9 px-2 text-xs font-semibold',
            locale === opt.value && 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]',
          )}
          onClick={() => setLocale(opt.value)}
          aria-pressed={locale === opt.value}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}
