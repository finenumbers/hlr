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

function dash(t: Translate): string {
  return t('common.dash');
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
