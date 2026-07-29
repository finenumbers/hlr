import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatMoney(amount: string | number, currency = 'RUB'): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (Number.isNaN(n)) return `${amount} ${currency}`;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 4,
  }).format(n);
}

export function formatDate(
  value: string | Date | null | undefined,
  locale: string = 'en-GB',
): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  const tag = locale.startsWith('ru') ? 'ru-RU' : 'en-GB';
  return new Intl.DateTimeFormat(tag, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}
