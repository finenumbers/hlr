/**
 * Shared column matrix for job-items export (CSV legacy helpers + XLSX).
 */

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

export type ExportLocale = 'en' | 'ru';

export type ExportItem = {
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

export function buildJobItemsExportHeader(
  checkType: string,
  locale: ExportLocale,
): string[] {
  const L = LABELS[locale];
  const isHlr = checkType === 'HLR';
  return [
    L.checkType,
    L.service,
    L.phone,
    L.status,
    L.resultStatus,
    L.isReachable,
    ...(isHlr ? [...HLR_EXTRA_FIELDS, L.errors] : []),
    L.errorMessage,
  ];
}

export function buildJobItemsExportRow(
  checkType: string,
  locale: ExportLocale,
  item: ExportItem,
): string[] {
  const L = LABELS[locale];
  const isHlr = checkType === 'HLR';
  const service =
    checkType === 'PING' ? L.ping : checkType === 'HLR' ? L.hlr : checkType;
  const cells: string[] = [
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
      cells.push(
        field === 'roaming'
          ? labelBool(locale, value as boolean | null)
          : value == null
            ? ''
            : String(value),
      );
    }
    cells.push(item.errorCode ?? '');
  }
  cells.push(sanitizeError(item.errorMessage));
  return cells;
}
