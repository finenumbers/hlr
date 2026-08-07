/**
 * Resolve capture vs release when healing open HOLDs on finalize.
 * Prefer persisted JobItem.billingAction; legacy rows use a safe heuristic.
 */
export function resolveJobItemSettleAction(item: {
  status: string;
  billingAction?: string | null;
  resultStatus?: string | null;
}): 'capture' | 'release' {
  if (item.billingAction === 'CAPTURE') return 'capture';
  if (item.billingAction === 'RELEASE') return 'release';

  // Legacy / null billingAction:
  // Provider-final outcomes carry a normalized resultStatus → capture (Policy B).
  if (item.status === 'COMPLETED') return 'capture';
  if (
    item.resultStatus === 'reachable' ||
    item.resultStatus === 'unreachable' ||
    item.resultStatus === 'error'
  ) {
    return 'capture';
  }
  // Prefer not charging when intent is unknown (timeout / submit-fail / DLQ).
  return 'release';
}
