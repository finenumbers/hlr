import { describe, expect, it } from 'vitest';

import { buildJobItemsExportHeader } from './job-items-export';
import { buildJobItemsXlsxBuffer, jobItemsXlsxFilename } from './job-items-xlsx';

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
          errorCode: '8',
          errorMessage: 'Provider error 8: cannot deliver',
        },
      ],
    });

    expect(buffer.subarray(0, 2).toString('utf8')).toBe('PK');
    expect(buildJobItemsExportHeader('HLR', 'ru').length).toBeGreaterThan(10);
    expect(jobItemsXlsxFilename('HLR', 'job-1')).toBe('hlr-job-1.xlsx');
  });

  it('builds PING workbook with fewer columns', async () => {
    const header = buildJobItemsExportHeader('PING', 'en');
    expect(header).not.toContain('operatorName');
    const buffer = await buildJobItemsXlsxBuffer({
      checkType: 'PING',
      locale: 'en',
      items: [],
    });
    expect(buffer.subarray(0, 2).toString('utf8')).toBe('PK');
    // header-only sheet still has used range
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
