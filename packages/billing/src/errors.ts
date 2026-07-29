export type BillingErrorCode =
  | 'INSUFFICIENT_FUNDS'
  | 'TARIFF_NOT_CONFIGURED'
  | 'INVALID_TARIFF'
  | 'PRICE_SNAPSHOT_MISSING'
  | 'CHECK_TYPE_MISMATCH'
  | 'WALLET_NOT_FOUND'
  | 'HOLD_NOT_FOUND'
  | 'INVALID_AMOUNT'
  | 'NEGATIVE_BALANCE_FORBIDDEN'
  | 'CONCURRENT_MODIFICATION'
  | 'VALIDATION_FAILED';

export class BillingError extends Error {
  readonly code: BillingErrorCode;
  readonly details?: Record<string, unknown>;
  readonly retryable: boolean;

  constructor(
    code: BillingErrorCode,
    message: string,
    options?: { details?: Record<string, unknown>; retryable?: boolean; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'BillingError';
    this.code = code;
    this.details = options?.details;
    this.retryable = options?.retryable ?? false;
  }
}

export function isBillingError(error: unknown): error is BillingError {
  return error instanceof BillingError;
}
