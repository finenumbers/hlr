/**
 * Visual tone for an HLR job-item row (UI + XLSX export).
 * Only meaningful for HLR checkType — callers must gate on that.
 */
export type HlrRowTone = 'success' | 'fail' | 'error';

export function hlrRowTone(input: {
  resultStatus: string | null | undefined;
  status?: string | null | undefined;
}): HlrRowTone | null {
  const resultStatus = input.resultStatus ?? '';
  if (resultStatus === 'reachable') return 'success';
  if (resultStatus === 'unreachable') return 'fail';
  if (resultStatus === 'error') return 'error';
  if (resultStatus === '' && input.status === 'FAILED') {
    return 'error';
  }
  return null;
}
