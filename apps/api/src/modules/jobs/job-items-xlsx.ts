import ExcelJS from 'exceljs';

import {
  buildJobItemsExportHeader,
  buildJobItemsExportRow,
  type ExportItem,
  type ExportLocale,
} from './job-items-export';

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};

const CENTER: Partial<ExcelJS.Alignment> = {
  vertical: 'middle',
  horizontal: 'center',
  wrapText: true,
};

/**
 * Build a styled XLSX workbook for job item results.
 * Header: bold + center. All cells: center + thin borders over used range.
 */
export async function buildJobItemsXlsxBuffer(input: {
  checkType: string;
  locale: ExportLocale;
  items: ExportItem[];
}): Promise<Buffer> {
  const { checkType, locale, items } = input;
  const header = buildJobItemsExportHeader(checkType, locale);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Finenumbers HLR';
  const sheet = workbook.addWorksheet('results', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const headerRow = sheet.addRow(header);
  headerRow.font = { bold: true };
  headerRow.alignment = CENTER;

  for (const item of items) {
    const row = sheet.addRow(buildJobItemsExportRow(checkType, locale, item));
    row.alignment = CENTER;
  }

  const rowCount = Math.max(1, items.length + 1);
  const colCount = header.length;
  for (let r = 1; r <= rowCount; r += 1) {
    for (let c = 1; c <= colCount; c += 1) {
      const cell = sheet.getCell(r, c);
      cell.border = THIN_BORDER;
      cell.alignment = CENTER;
      if (r === 1) {
        cell.font = { bold: true };
      }
    }
  }

  for (let c = 1; c <= colCount; c += 1) {
    const col = sheet.getColumn(c);
    let max = 10;
    col.eachCell({ includeEmpty: true }, (cell) => {
      const len = String(cell.value ?? '').length;
      if (len > max) max = len;
    });
    col.width = Math.min(40, Math.max(12, max + 2));
  }

  const raw = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
}

export function jobItemsXlsxFilename(checkType: string, jobId: string): string {
  const slug =
    checkType === 'PING' ? 'ping-sms' : checkType === 'HLR' ? 'hlr' : 'job';
  return `${slug}-${jobId}.xlsx`;
}
