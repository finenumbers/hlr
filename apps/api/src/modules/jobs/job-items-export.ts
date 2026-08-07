/**
 * Job-items export matrix — mirrors cabinet/admin results table
 * (`jobItemResultColumns` with includeError: true).
 */

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

const DASH = '—';

/** Headers aligned with cabinetJobs.col* / adminJobs.col* (RU/EN). */
const HEADERS = {
  en: {
    phone: 'Phone',
    status: 'Status',
    result: 'Result',
    reachable: 'Reachable',
    operator: 'Operator',
    country: 'Country',
    region: 'Region',
    mccMnc: 'MCC/MNC',
    imsi: 'IMSI',
    msc: 'MSC',
    roaming: 'Roaming',
    roamingCountry: 'Roaming country',
    roamingOperator: 'Roaming operator',
    errors: 'Errors',
    details: 'Details',
  },
  ru: {
    phone: 'Телефон',
    status: 'Статус',
    result: 'Результат',
    reachable: 'Доступен',
    operator: 'Оператор',
    country: 'Страна',
    region: 'Регион',
    mccMnc: 'MCC/MNC',
    imsi: 'IMSI',
    msc: 'MSC',
    roaming: 'Роуминг',
    roamingCountry: 'Страна роуминга',
    roamingOperator: 'Оператор роуминга',
    errors: 'Ошибки',
    details: 'Подробности',
  },
} as const;

const JOB_ITEM_STATUS: Record<ExportLocale, Record<string, string>> = {
  en: {
    QUEUED: 'QUEUED',
    RESERVED: 'RESERVED',
    SENT: 'SENT',
    PENDING: 'PENDING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED',
  },
  ru: {
    QUEUED: 'в очереди',
    RESERVED: 'зарезервирован',
    SENT: 'отправлен провайдеру',
    PENDING: 'ждём ответ',
    COMPLETED: 'готов',
    FAILED: 'ошибка',
    CANCELLED: 'отменён',
  },
};

const RESULT_STATUS: Record<ExportLocale, Record<string, string>> = {
  en: {
    reachable: 'reachable',
    unreachable: 'unreachable',
    pending: 'pending',
    error: 'error',
    unknown: 'unknown',
  },
  ru: {
    reachable: 'в сети',
    unreachable: 'не в сети',
    pending: 'в обработке',
    error: 'ошибка проверки',
    unknown: 'нет данных',
  },
};

const BOOL: Record<ExportLocale, { yes: string; no: string }> = {
  en: { yes: 'true', no: 'false' },
  ru: { yes: 'да', no: 'нет' },
};

/** Provider status `err` codes — same copy as web `smscErr.*` (no brand). */
const PROVIDER_STATUS_ERR: Record<ExportLocale, Record<string, string>> = {
  en: {
    '0': 'No error',
    '1': 'Subscriber does not exist',
    '6': 'Subscriber is offline',
    '11': 'Service not connected',
    '12': 'Error in subscriber handset',
    '13': 'Subscriber blocked',
    '21': 'Service not supported',
    '200': 'Virtual send',
    '219': 'SIM card replaced',
    '220': 'Operator queue full',
    '237': 'Subscriber not answering',
    '238': 'No template',
    '239': 'Forbidden IP address',
    '240': 'Subscriber busy',
    '241': 'Conversion error',
    '242': 'Answering machine detected',
    '243': 'No contract',
    '244': 'Broadcast forbidden',
    '245': 'Status not received',
    '246': 'Time restriction',
    '247': 'Message limit exceeded',
    '248': 'No route',
    '249': 'Invalid number format',
    '250': 'Number forbidden by settings',
    '251': 'Per-number limit exceeded',
    '252': 'Number forbidden',
    '253': 'Blocked by spam filter',
    '254': 'Unregistered sender id',
    '255': 'Rejected by operator',
  },
  ru: {
    '0': 'Нет ошибки',
    '1': 'Абонент не существует',
    '6': 'Абонент не в сети',
    '11': 'Не подключена услуга',
    '12': 'Ошибка в телефоне абонента',
    '13': 'Абонент заблокирован',
    '21': 'Нет поддержки сервиса',
    '200': 'Виртуальная отправка',
    '219': 'Замена sim-карты',
    '220': 'Переполнена очередь у оператора',
    '237': 'Абонент не отвечает',
    '238': 'Нет шаблона',
    '239': 'Запрещенный ip-адрес',
    '240': 'Абонент занят',
    '241': 'Ошибка конвертации',
    '242': 'Зафиксирован автоответчик',
    '243': 'Не заключен договор',
    '244': 'Рассылка запрещена',
    '245': 'Статус не получен',
    '246': 'Ограничение по времени',
    '247': 'Превышен лимит сообщений',
    '248': 'Нет маршрута',
    '249': 'Неверный формат номера',
    '250': 'Номер запрещен настройками',
    '251': 'Превышен лимит на один номер',
    '252': 'Номер запрещен',
    '253': 'Запрещено спам-фильтром',
    '254': 'Незарегистрированный sender id',
    '255': 'Отклонено оператором',
  },
};

/** Provider API error_code 1–9 — same copy as web `smscApiErr.*`. */
const PROVIDER_API_ERR: Record<ExportLocale, Record<string, string>> = {
  en: {
    '1': 'Invalid request parameters',
    '2': 'Provider authorization error',
    '3': 'Insufficient funds at provider',
    '4': 'IP address blocked by provider',
    '5': 'Invalid date in request',
    '6': 'Forbidden by provider',
    '7': 'Invalid phone number',
    '8': 'Cannot deliver / check number',
    '9': 'Too many identical requests',
  },
  ru: {
    '1': 'Неверные параметры запроса',
    '2': 'Ошибка авторизации у провайдера',
    '3': 'Недостаточно средств у провайдера',
    '4': 'IP-адрес заблокирован провайдером',
    '5': 'Некорректная дата в запросе',
    '6': 'Запрещено провайдером',
    '7': 'Неверный номер телефона',
    '8': 'Невозможно доставить / проверить номер',
    '9': 'Слишком много одинаковых запросов',
  },
};

/** Platform job/item errorCode → Details text (mirrors web labels.itemError). */
const ITEM_ERROR: Record<ExportLocale, Record<string, string>> = {
  en: {
    CHECK_TIMEOUT: 'Timed out waiting for provider final status',
    QUEUE_DEAD_LETTER: 'Processing queue failure',
    MISSING_PROVIDER_MESSAGE_ID: 'Cannot poll without provider message id',
    RESERVED_STALE_TIMEOUT: 'Reserved item exceeded check timeout',
    CSV_EMPTY: 'CSV contained no phone numbers',
    CSV_TOO_MANY_ROWS: 'CSV exceeds maximum row limit',
    CSV_INVALID_PHONES: 'CSV contains invalid phone numbers',
    PRICE_SNAPSHOT_MISSING: 'Tariff price snapshot is missing',
    CSV_PARSE_ABANDONED: 'Could not parse CSV upload',
  },
  ru: {
    CHECK_TIMEOUT: 'Истекло время ожидания ответа провайдера',
    QUEUE_DEAD_LETTER: 'Сбой очереди обработки',
    MISSING_PROVIDER_MESSAGE_ID: 'Нет идентификатора сообщения у провайдера',
    RESERVED_STALE_TIMEOUT: 'Превышено время ожидания отправки',
    CSV_EMPTY: 'CSV не содержит номеров телефонов',
    CSV_TOO_MANY_ROWS: 'CSV превышает лимит строк',
    CSV_INVALID_PHONES: 'В CSV есть некорректные номера',
    PRICE_SNAPSHOT_MISSING: 'Не задана цена тарифа',
    CSV_PARSE_ABANDONED: 'Не удалось разобрать CSV',
  },
};

const PROVIDER_API_ERR_CODES = new Set(Object.keys(PROVIDER_API_ERR.en));

function text(value: unknown): string {
  if (value == null || value === '') return DASH;
  return String(value);
}

function labelStatus(locale: ExportLocale, status: string): string {
  if (!status) return DASH;
  return JOB_ITEM_STATUS[locale][status] ?? status;
}

function labelResult(locale: ExportLocale, resultStatus: string | null): string {
  if (resultStatus == null || resultStatus === '') return DASH;
  return RESULT_STATUS[locale][resultStatus] ?? resultStatus;
}

function labelBool(locale: ExportLocale, value: boolean | null): string {
  if (value == null) return DASH;
  return value ? BOOL[locale].yes : BOOL[locale].no;
}

function mccMnc(item: ExportItem): string {
  if (item.mcc == null && item.mnc == null) return DASH;
  return `${item.mcc ?? DASH}/${item.mnc ?? DASH}`;
}

function isSubmitTimeProviderFailure(item: ExportItem): boolean {
  return (
    item.status === 'FAILED' &&
    (item.resultStatus == null || item.resultStatus === '')
  );
}

function providerItemErrorLabel(
  locale: ExportLocale,
  item: ExportItem,
): string {
  const code = item.errorCode?.trim() ?? '';
  if (!code) return DASH;
  if (isSubmitTimeProviderFailure(item) && PROVIDER_API_ERR_CODES.has(code)) {
    return PROVIDER_API_ERR[locale][code] ?? code;
  }
  return PROVIDER_STATUS_ERR[locale][code] ?? code;
}

/** Strip supplier brand; never mention SMSC in client-facing export. */
export function sanitizeClientBrandText(
  textValue: string | null | undefined,
  locale: ExportLocale,
): string {
  if (textValue == null || textValue === '') return '';
  const replacement = locale === 'ru' ? 'провайдер' : 'provider';
  return textValue.replace(/\bSMSC(?:\.ru)?\b/gi, replacement);
}

function labelDetails(locale: ExportLocale, item: ExportItem): string {
  const code = item.errorCode?.trim() ?? '';
  if (code && ITEM_ERROR[locale][code]) {
    return ITEM_ERROR[locale][code]!;
  }
  const scrubbed = sanitizeClientBrandText(item.errorMessage, locale);
  return scrubbed ? scrubbed : DASH;
}

export function buildJobItemsExportHeader(
  checkType: string,
  locale: ExportLocale,
): string[] {
  const H = HEADERS[locale];
  const isHlr = checkType === 'HLR';
  return [
    H.phone,
    H.status,
    H.result,
    H.reachable,
    ...(isHlr
      ? [
          H.operator,
          H.country,
          H.region,
          H.mccMnc,
          H.imsi,
          H.msc,
          H.roaming,
          H.roamingCountry,
          H.roamingOperator,
          H.errors,
        ]
      : []),
    H.details,
  ];
}

export function buildJobItemsExportRow(
  checkType: string,
  locale: ExportLocale,
  item: ExportItem,
): string[] {
  const isHlr = checkType === 'HLR';
  const cells: string[] = [
    text(item.phoneE164),
    labelStatus(locale, item.status),
    labelResult(locale, item.resultStatus),
    labelBool(locale, item.isReachable),
  ];
  if (isHlr) {
    cells.push(
      text(item.operatorName),
      text(item.countryCode),
      text(item.region),
      mccMnc(item),
      text(item.imsi),
      text(item.msc),
      labelBool(locale, item.roaming),
      text(item.roamingCountry),
      text(item.roamingOperator),
      providerItemErrorLabel(locale, item),
    );
  }
  cells.push(labelDetails(locale, item));
  return cells;
}

/** Exported for unit tests / UI parity checks. */
export const EXPORT_DASH = DASH;
export const EXPORT_ITEM_ERROR = ITEM_ERROR;
