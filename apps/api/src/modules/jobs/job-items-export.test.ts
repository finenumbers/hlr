import { describe, expect, it } from 'vitest';

import {
  buildJobItemsExportHeader,
  buildJobItemsExportRow,
  EXPORT_DASH,
  type ExportItem,
} from './job-items-export';

function baseItem(overrides: Partial<ExportItem> = {}): ExportItem {
  return {
    phoneE164: '+79991234567',
    status: 'COMPLETED',
    resultStatus: 'reachable',
    isReachable: true,
    operatorName: 'MTS',
    countryCode: 'RU',
    region: 'Moscow',
    mcc: '250',
    mnc: '01',
    imsi: '25001',
    msc: 'msc1',
    roaming: false,
    roamingCountry: null,
    roamingOperator: null,
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

describe('job-items-export mirrors results table', () => {
  it('RU HLR headers match cabinetJobs column titles', () => {
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
  });

  it('RU PING headers omit HLR-only columns', () => {
    expect(buildJobItemsExportHeader('PING', 'ru')).toEqual([
      'Телефон',
      'Статус',
      'Результат',
      'Доступен',
      'Подробности',
    ]);
  });

  it('does not include checkType or service columns', () => {
    const header = buildJobItemsExportHeader('HLR', 'ru').join(' ');
    expect(header).not.toMatch(/checkType|service/i);
  });

  it('localizes RU cells like the results table', () => {
    const row = buildJobItemsExportRow(
      'HLR',
      'ru',
      baseItem({
        status: 'FAILED',
        resultStatus: null,
        isReachable: null,
        roaming: null,
        roamingCountry: null,
        errorCode: '8',
        errorMessage: 'SMSC.ru cannot deliver',
      }),
    );
    expect(row[0]).toBe('+79991234567');
    expect(row[1]).toBe('ошибка');
    expect(row[2]).toBe(EXPORT_DASH);
    expect(row[3]).toBe(EXPORT_DASH);
    expect(row[7]).toBe('250/01'); // MCC/MNC combined
    expect(row[13]).toBe('Невозможно доставить / проверить номер'); // API prefer
    expect(row[14]).toContain('провайдер');
    expect(row[14]).not.toMatch(/SMSC/i);
  });

  it('uses status-err label when resultStatus is present', () => {
    const row = buildJobItemsExportRow(
      'HLR',
      'ru',
      baseItem({
        status: 'FAILED',
        resultStatus: 'unreachable',
        isReachable: false,
        errorCode: '1',
        errorMessage: null,
      }),
    );
    expect(row[2]).toBe('не в сети');
    expect(row[13]).toBe('Абонент не существует');
    expect(row[14]).toBe(EXPORT_DASH);
  });

  it('maps platform CHECK_TIMEOUT in Details', () => {
    const row = buildJobItemsExportRow(
      'HLR',
      'ru',
      baseItem({
        status: 'FAILED',
        resultStatus: null,
        errorCode: 'CHECK_TIMEOUT',
        errorMessage: 'Timed out waiting for provider final status',
      }),
    );
    expect(row[14]).toBe('Истекло время ожидания ответа провайдера');
  });

  it('uses dash for empty HLR fields', () => {
    const row = buildJobItemsExportRow(
      'HLR',
      'ru',
      baseItem({
        operatorName: null,
        countryCode: null,
        region: null,
        mcc: null,
        mnc: null,
        imsi: null,
        msc: null,
        roamingCountry: null,
        roamingOperator: null,
        errorCode: null,
        errorMessage: null,
      }),
    );
    expect(row[4]).toBe(EXPORT_DASH);
    expect(row[7]).toBe(EXPORT_DASH);
    expect(row[13]).toBe(EXPORT_DASH);
    expect(row[14]).toBe(EXPORT_DASH);
  });
});
