const UTF8_BOM = '\uFEFF';

/** Quote a CSV field (RFC-style); always quote for Excel safety with `;` delimiter. */
export function csvEscape(value: unknown): string {
  const raw = value == null ? '' : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

/**
 * Build Excel-friendly CSV: UTF-8 BOM, semicolon delimiter, CRLF.
 * RU Excel opens `;` as columns; BOM keeps Cyrillic readable.
 */
export function buildExcelCsv(rows: unknown[][]): string {
  const lines = rows.map((row) => row.map(csvEscape).join(';'));
  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}

export function downloadCsv(filename: string, content: string): void {
  downloadBlob(filename, new Blob([content], { type: 'text/csv;charset=utf-8' }));
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
