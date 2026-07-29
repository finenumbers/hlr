'use client';

import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog backdrop"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        className={cn(
          'relative z-10 w-full max-w-lg rounded-xl border border-[var(--color-line)] bg-[var(--color-panel-elevated)] p-5 shadow-xl',
          className,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">{title}</h2>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  danger,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <p className="mb-5 text-sm text-[var(--color-ink-muted)]">{description}</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          type="button"
          variant={danger ? 'danger' : 'default'}
          onClick={onConfirm}
          disabled={loading}
        >
          {loading ? 'Working…' : confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
