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

export type SmscErrCode = (typeof SMSC_ERR_CODES)[number];

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function normalizeSmscErrCode(code: unknown): string | null {
  if (code == null || code === '') return null;
  return String(code).trim();
}

/** Human-readable SMSC err title for the current locale; unknown codes stay as digits. */
export function smscErrLabel(code: unknown, t: Translate): string | null {
  const normalized = normalizeSmscErrCode(code);
  if (normalized == null) return null;
  const key = `smscErr.${normalized}`;
  const label = t(key);
  if (!label || label === key) return normalized;
  return label;
}
