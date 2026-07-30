'use client';

import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  page,
  pageSize,
  total,
  onPageChange,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const t = useT();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="w-full overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-panel-elevated)]">
      <div className="w-full overflow-x-auto">
        <table className="w-full min-w-full text-left text-sm">
          <thead className="border-b border-[var(--color-line)] bg-[color-mix(in_oklab,var(--color-panel)_70%,transparent)]">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-3 text-xs font-bold text-[var(--color-ink-muted)] ${col.className ?? ''}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className="border-b border-[var(--color-line)] last:border-0 hover:bg-[color-mix(in_oklab,var(--color-accent)_6%,transparent)]"
              >
                {columns.map((col) => (
                  <td key={col.key} className={`px-4 py-3 align-middle ${col.className ?? ''}`}>
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-[var(--color-line)] px-4 py-3 text-xs text-[var(--color-ink-muted)]">
        <span>{t('common.tableFooter', { total, page, totalPages })}</span>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            {t('common.prev')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            {t('common.next')}
          </Button>
        </div>
      </div>
    </div>
  );
}
