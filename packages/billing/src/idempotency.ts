/** Deterministic ledger idempotency keys — retries must hit the unique constraint, not double-post. */

export function holdIdempotencyKey(jobItemId: string): string {
  return `hold:jobItem:${jobItemId}`;
}

export function debitIdempotencyKey(jobItemId: string): string {
  return `debit:jobItem:${jobItemId}`;
}

export function releaseIdempotencyKey(jobItemId: string): string {
  return `release:jobItem:${jobItemId}`;
}

/** Remainder release after partial capture (charge < hold). */
export function releaseRemainderIdempotencyKey(jobItemId: string): string {
  return `release-remainder:jobItem:${jobItemId}`;
}

export function topupIdempotencyKey(tenantId: string, key: string): string {
  return `topup:${tenantId}:${key}`;
}

export function adjustmentIdempotencyKey(tenantId: string, key: string): string {
  return `adjustment:${tenantId}:${key}`;
}
