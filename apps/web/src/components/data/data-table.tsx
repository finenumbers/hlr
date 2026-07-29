import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';

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
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-panel-elevated)]">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[var(--color-line)] bg-[color-mix(in_oklab,var(--color-panel)_70%,transparent)]">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] ${col.className ?? ''}`}
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
        <span>
          {total} total · page {page} / {totalPages}
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Prev
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
