type Translate = (key: string, params?: Record<string, string | number>) => string;

const JOB_ITEM_STATUSES = new Set([
  'QUEUED',
  'RESERVED',
  'SENT',
  'PENDING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

const JOB_STATUSES = new Set([
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'COMPLETED_WITH_ERRORS',
  'FAILED',
  'CANCELLED',
]);

const RESULT_STATUSES = new Set([
  'reachable',
  'unreachable',
  'pending',
  'error',
  'unknown',
]);

const PROVIDER_REQUEST_KINDS = new Set([
  'SEND',
  'STATUS',
  'COST',
  'BALANCE',
  'OTHER',
]);

const PROVIDER_REQUEST_STATUSES = new Set(['PENDING', 'SUCCEEDED', 'FAILED']);

function dash(t: Translate): string {
  return t('common.dash');
}

export type StatusBadgeTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent';

/**
 * Badge tone for job-level status:
 * готов → green, ошибка → red, в работе → yellow.
 */
export function jobStatusTone(value: unknown): StatusBadgeTone {
  switch (String(value ?? '')) {
    case 'COMPLETED':
      return 'ok';
    case 'FAILED':
      return 'danger';
    case 'PROCESSING':
      return 'warn';
    case 'COMPLETED_WITH_ERRORS':
      return 'warn';
    default:
      return 'neutral';
  }
}

/** Job-level status (list filters + job card). */
export function labelJobStatus(value: unknown, t: Translate): string {
  if (value == null || value === '') return dash(t);
  const code = String(value);
  if (!JOB_STATUSES.has(code)) return code;
  return t(`labels.jobStatus.${code}`);
}

/** Per-item lifecycle status in result tables. */
export function labelJobItemStatus(value: unknown, t: Translate): string {
  if (value == null || value === '') return dash(t);
  const code = String(value);
  if (!JOB_ITEM_STATUSES.has(code)) return code;
  return t(`labels.jobItemStatus.${code}`);
}

/** Provider resultStatus (reachable / unreachable / …). */
export function labelResultStatus(value: unknown, t: Translate): string {
  if (value == null || value === '') return dash(t);
  const code = String(value);
  if (!RESULT_STATUSES.has(code)) return code;
  return t(`labels.resultStatus.${code}`);
}

/** Boolean columns: reachable, roaming. */
export function labelBool(value: unknown, t: Translate): string {
  if (value == null || value === '') return dash(t);
  if (value === true || value === 'true') return t('labels.bool.yes');
  if (value === false || value === 'false') return t('labels.bool.no');
  return String(value);
}

/** Provider request kind (SEND / STATUS / COST / …). */
export function labelProviderRequestKind(value: unknown, t: Translate): string {
  if (value == null || value === '') return dash(t);
  const code = String(value);
  if (!PROVIDER_REQUEST_KINDS.has(code)) return code;
  return t(`labels.providerRequestKind.${code}`);
}

/** Provider request status (PENDING / SUCCEEDED / FAILED). */
export function labelProviderRequestStatus(value: unknown, t: Translate): string {
  if (value == null || value === '') return dash(t);
  const code = String(value);
  if (!PROVIDER_REQUEST_STATUSES.has(code)) return code;
  return t(`labels.providerRequestStatus.${code}`);
}

const ITEM_ERROR_CODES = new Set([
  'CHECK_TIMEOUT',
  'QUEUE_DEAD_LETTER',
  'MISSING_PROVIDER_MESSAGE_ID',
  'RESERVED_STALE_TIMEOUT',
  'CSV_EMPTY',
  'CSV_TOO_MANY_ROWS',
  'CSV_INVALID_PHONES',
  'PRICE_SNAPSHOT_MISSING',
  'CSV_PARSE_ABANDONED',
]);

/** Strip supplier brand from client-visible error text. */
export function scrubClientBrandText(text: string, t: Translate): string {
  return text.replace(/\bSMSC(?:\.ru)?\b/gi, t('common.providerBrand'));
}

/**
 * Details column / job error body: prefer mapped platform code, else scrubbed message.
 */
export function labelItemErrorDetails(
  errorCode: unknown,
  errorMessage: unknown,
  t: Translate,
): string {
  const code = errorCode == null || errorCode === '' ? '' : String(errorCode).trim();
  if (code && ITEM_ERROR_CODES.has(code)) {
    const key = `labels.itemError.${code}`;
    const mapped = t(key);
    if (mapped && mapped !== key) return mapped;
  }
  if (errorMessage == null || errorMessage === '') return dash(t);
  return scrubClientBrandText(String(errorMessage), t);
}

/** Job-level error banner: localized code message or code — scrubbed message. */
export function labelJobErrorBanner(
  errorCode: unknown,
  errorMessage: unknown,
  t: Translate,
): string | null {
  const code = errorCode == null || errorCode === '' ? '' : String(errorCode).trim();
  const message =
    errorMessage == null || errorMessage === ''
      ? ''
      : scrubClientBrandText(String(errorMessage), t);
  if (code && ITEM_ERROR_CODES.has(code)) {
    const key = `labels.itemError.${code}`;
    const mapped = t(key);
    if (mapped && mapped !== key) return mapped;
  }
  if (!code && !message) return null;
  if (code && message) return `${code} — ${message}`;
  return code || message;
}
