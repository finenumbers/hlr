/** SMSC status `err` codes (SMS/HLR), see https://smsc.ru/api/http/status_messages/errors/ */
export const SMSC_ERR_CODES = [
  '0',
  '1',
  '6',
  '11',
  '12',
  '13',
  '21',
  '200',
  '219',
  '220',
  '237',
  '238',
  '239',
  '240',
  '241',
  '242',
  '243',
  '244',
  '245',
  '246',
  '247',
  '248',
  '249',
  '250',
  '251',
  '252',
  '253',
  '254',
  '255',
] as const;

/** SMSC send/status HTTP API `error_code` (request-level failures). */
export const SMSC_API_ERR_CODES = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
] as const;

export type SmscErrCode = (typeof SMSC_ERR_CODES)[number];
export type SmscApiErrCode = (typeof SMSC_API_ERR_CODES)[number];

type Translate = (key: string, params?: Record<string, string | number>) => string;

const SMSC_API_ERR_SET = new Set<string>(SMSC_API_ERR_CODES);

export function normalizeSmscErrCode(code: unknown): string | null {
  if (code == null || code === '') return null;
  return String(code).trim();
}

/** Human-readable SMSC status err title; unknown codes stay as digits. */
export function smscErrLabel(code: unknown, t: Translate): string | null {
  const normalized = normalizeSmscErrCode(code);
  if (normalized == null) return null;
  const key = `smscErr.${normalized}`;
  const label = t(key);
  if (!label || label === key) return normalized;
  return label;
}

/** Human-readable SMSC API error_code (1–9) title. */
export function smscApiErrLabel(code: unknown, t: Translate): string | null {
  const normalized = normalizeSmscErrCode(code);
  if (normalized == null) return null;
  if (!SMSC_API_ERR_SET.has(normalized)) return null;
  const key = `smscApiErr.${normalized}`;
  const label = t(key);
  if (!label || label === key) return normalized;
  return label;
}

/**
 * Label for JobItem.errorCode.
 * API codes 1–9 overlap status err 1/6 — prefer API labels only for submit-time
 * failures (FAILED with no resultStatus).
 */
export function providerItemErrorLabel(
  code: unknown,
  t: Translate,
  opts?: { preferApi?: boolean },
): string | null {
  if (opts?.preferApi) {
    const api = smscApiErrLabel(code, t);
    if (api != null) return api;
  }
  return smscErrLabel(code, t);
}

/** True when the item failed at provider submit (no HLR/status result yet). */
export function isSubmitTimeProviderFailure(row: {
  status?: unknown;
  resultStatus?: unknown;
}): boolean {
  return (
    String(row.status ?? '') === 'FAILED' &&
    (row.resultStatus == null || row.resultStatus === '')
  );
}
