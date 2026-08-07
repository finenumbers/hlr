import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { buildJobItemsExportHeader } from './job-items-export';
import { buildJobItemsXlsxBuffer, jobItemsXlsxFilename } from './job-items-xlsx';

function emptyExtras() {
  return {
    operatorName: null,
    countryCode: null,
    region: null,
    mcc: null,
    mnc: null,
    imsi: null,
    msc: null,
    roaming: null,
    roamingCountry: null,
    roamingOperator: null,
    errorCode: null as string | null,
    errorMessage: null as string | null,
  };
}

describe('job-items-xlsx', () => {
  it('builds a ZIP/XLSX buffer with HLR columns', async () => {
    const buffer = await buildJobItemsXlsxBuffer({
      checkType: 'HLR',
      locale: 'ru',
      items: [
        {
          phoneE164: '+79991234567',
          status: 'FAILED',
          resultStatus: null,
          isReachable: null,
          ...emptyExtras(),
          errorCode: '8',
          errorMessage: 'Provider error 8: cannot deliver',
        },
      ],
    });

    expect(buffer.subarray(0, 2).toString('utf8')).toBe('PK');
    expect(buildJobItemsExportHeader('HLR', 'ru')).toEqual([
      'Телефон',
      'Статус',
      'Результат',
      'Доступен',
      'Оператор',
      'Страна',
      'Регион',
      'MCC/MNC',
      'IMSI',
      'MSC',
      'Роуминг',
      'Страна роуминга',
      'Оператор роуминга',
      'Ошибки',
      'Подробности',
    ]);
    expect(jobItemsXlsxFilename('HLR', 'job-1')).toBe('hlr-job-1.xlsx');
  });

  it('applies HLR row fills and autofits wide columns', async () => {
    const longPhone = `+7${'9'.repeat(40)}`;
    const buffer = await buildJobItemsXlsxBuffer({
      checkType: 'HLR',
      locale: 'en',
      items: [
        {
          phoneE164: longPhone,
          status: 'COMPLETED',
          resultStatus: 'reachable',
          isReachable: true,
          ...emptyExtras(),
        },
        {
          phoneE164: '+79991112233',
          status: 'COMPLETED',
          resultStatus: 'unreachable',
          isReachable: false,
          ...emptyExtras(),
        },
        {
          phoneE164: '+79991112244',
          status: 'FAILED',
          resultStatus: 'error',
          isReachable: null,
          ...emptyExtras(),
          errorCode: '8',
          errorMessage: 'fail',
        },
      ],
    });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = wb.getWorksheet('results');
    expect(sheet).toBeTruthy();

    const fillOf = (row: number) =>
      String(
        (sheet!.getRow(row).getCell(1).fill as ExcelJS.FillPattern | undefined)
          ?.fgColor?.argb ?? '',
      );

    expect(fillOf(2)).toBe('FFC6EFCE'); // success
    expect(fillOf(3)).toBe('FFFFC7CE'); // fail
    expect(fillOf(4)).toBe('FFFFEB9C'); // error

    // phone is column 1 after dropping checkType/service
    const phoneCol = sheet!.getColumn(1);
    expect(Number(phoneCol.width)).toBeGreaterThanOrEqual(longPhone.length);
  });

  it('builds PING workbook without HLR fills', async () => {
    const header = buildJobItemsExportHeader('PING', 'en');
    expect(header).not.toContain('Operator');
    expect(header[0]).toBe('Phone');
    const buffer = await buildJobItemsXlsxBuffer({
      checkType: 'PING',
      locale: 'en',
      items: [
        {
          phoneE164: '+79991234567',
          status: 'COMPLETED',
          resultStatus: 'reachable',
          isReachable: true,
          ...emptyExtras(),
        },
      ],
    });
    expect(buffer.subarray(0, 2).toString('utf8')).toBe('PK');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = wb.getWorksheet('results')!;
    const fill = sheet.getRow(2).getCell(1).fill as ExcelJS.FillPattern | undefined;
    expect(fill?.fgColor?.argb).toBeUndefined();
  });
});
