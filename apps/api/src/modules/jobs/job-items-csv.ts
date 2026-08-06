import type { Readable } from 'node:stream';
import { Readable as NodeReadable } from 'node:stream';

const UTF8_BOM = '\uFEFF';

const HLR_EXTRA_FIELDS = [
  'operatorName',
  'countryCode',
  'region',
  'mcc',
  'mnc',
  'imsi',
  'msc',
  'roaming',
  'roamingCountry',
  'roamingOperator',
] as const;

type ExportLocale = 'en' | 'ru';

type ExportItem = {
  phoneE164: string;
  status: string;
  resultStatus: string | null;
  isReachable: boolean | null;
  operatorName: string | null;
  countryCode: string | null;
  region: string | null;
  mcc: string | null;
  mnc: string | null;
  imsi: string | null;
  msc: string | null;
  roaming: boolean | null;
  roamingCountry: string | null;
  roamingOperator: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

const LABELS = {
  en: {
    checkType: 'checkType',
    service: 'service',
    phone: 'phone',
    status: 'status',
    resultStatus: 'resultStatus',
    isReachable: 'isReachable',
    errors: 'errors',
    errorMessage: 'errorMessage',
    hlr: 'HLR',
    ping: 'Silent SMS',
    boolTrue: 'true',
    boolFalse: 'false',
  },
  ru: {
    checkType: 'checkType',
    service: 'service',
    phone: 'phone',
    status: 'status',
    resultStatus: 'resultStatus',
    isReachable: 'isReachable',
    errors: 'errors',
    errorMessage: 'errorMessage',
    hlr: 'HLR',
    ping: 'Silent SMS',
    boolTrue: 'true',
    boolFalse: 'false',
    jobItemStatus: {
      QUEUED: 'в очереди',
      RESERVED: 'зарезервирован',
      SENT: 'отправлен провайдеру',
      PENDING: 'ждём ответ',
      COMPLETED: 'готов',
      FAILED: 'ошибка',
      CANCELLED: 'отменён',
    } as Record<string, string>,
    resultStatusMap: {
      reachable: 'в сети',
      unreachable: 'не в сети',
      pending: 'в обработке',
      error: 'ошибка проверки',
      unknown: 'нет данных',
    } as Record<string, string>,
  },
} as const;

function csvEscape(value: unknown): string {
  const raw = value == null ? '' : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

function csvLine(cells: unknown[]): string {
  return `${cells.map(csvEscape).join(';')}\r\n`;
}

function labelStatus(locale: ExportLocale, status: string): string {
  if (locale === 'ru') {
    return LABELS.ru.jobItemStatus[status] ?? status;
  }
  return status;
}

function labelResult(locale: ExportLocale, resultStatus: string | null): string {
  if (resultStatus == null || resultStatus === '') return '';
  if (locale === 'ru') {
    return LABELS.ru.resultStatusMap[resultStatus] ?? resultStatus;
  }
  return resultStatus;
}

function labelBool(locale: ExportLocale, value: boolean | null): string {
  if (value == null) return '';
  return value ? LABELS[locale].boolTrue : LABELS[locale].boolFalse;
}

function sanitizeError(text: string | null): string {
  if (!text) return '';
  return text.replace(/\bSMSC(?:\.ru)?\b/gi, 'provider');
}

export function buildJobItemsCsvHeader(
  checkType: string,
  locale: ExportLocale,
): string {
  const L = LABELS[locale];
  const isHlr = checkType === 'HLR';
  const header = [
    L.checkType,
    L.service,
    L.phone,
    L.status,
    L.resultStatus,
    L.isReachable,
    ...(isHlr ? [...HLR_EXTRA_FIELDS, L.errors] : []),
    L.errorMessage,
  ];
  return `${UTF8_BOM}${csvLine(header)}`;
}

export function buildJobItemsCsvRow(
  checkType: string,
  locale: ExportLocale,
  item: ExportItem,
): string {
  const L = LABELS[locale];
  const isHlr = checkType === 'HLR';
  const service = checkType === 'PING' ? L.ping : checkType === 'HLR' ? L.hlr : checkType;
  const cells: unknown[] = [
    checkType,
    service,
    item.phoneE164,
    labelStatus(locale, item.status),
    labelResult(locale, item.resultStatus),
    labelBool(locale, item.isReachable),
  ];
  if (isHlr) {
    for (const field of HLR_EXTRA_FIELDS) {
      const value = item[field];
      cells.push(field === 'roaming' ? labelBool(locale, value as boolean | null) : (value ?? ''));
    }
    cells.push(item.errorCode ?? '');
  }
  cells.push(sanitizeError(item.errorMessage));
  return csvLine(cells);
}

export function createJobItemsCsvStream(input: {
  checkType: string;
  locale: ExportLocale;
  iterate: () => AsyncGenerator<ExportItem, void, unknown>;
}): Readable {
  const { checkType, locale, iterate } = input;
  let headerSent = false;
  const iterator = iterate();

  return new NodeReadable({
    async read() {
      try {
        if (!headerSent) {
          headerSent = true;
          this.push(buildJobItemsCsvHeader(checkType, locale));
        }
        const next = await iterator.next();
        if (next.done) {
          this.push(null);
          return;
        }
        this.push(buildJobItemsCsvRow(checkType, locale, next.value));
      } catch (error) {
        this.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    },
  });
}
