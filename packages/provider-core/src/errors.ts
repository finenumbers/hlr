export type ProviderErrorKind =
  | 'auth'
  | 'validation'
  | 'insufficient_funds'
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'provider'
  | 'signature'
  /** Duplicate / in-flight submit for the same idempotency key. */
  | 'conflict'
  | 'unknown';

export type ProviderErrorDetails = {
  providerCode: string;
  kind: ProviderErrorKind;
  message: string;
  /** Original provider error code when available (never drop). */
  providerErrorCode?: string | number | null;
  providerErrorMessage?: string | null;
  httpStatus?: number | null;
  retryable: boolean;
  correlationId?: string;
  cause?: unknown;
  rawResponse?: unknown;
};

/**
 * Typed adapter failure. Callers should inspect `kind` / `retryable`
 * without parsing provider-specific payloads.
 */
export class ProviderError extends Error {
  readonly providerCode: string;
  readonly kind: ProviderErrorKind;
  readonly providerErrorCode: string | number | null;
  readonly providerErrorMessage: string | null;
  readonly httpStatus: number | null;
  readonly retryable: boolean;
  readonly correlationId?: string;
  readonly rawResponse?: unknown;

  constructor(details: ProviderErrorDetails) {
    super(details.message);
    this.name = 'ProviderError';
    this.providerCode = details.providerCode;
    this.kind = details.kind;
    this.providerErrorCode = details.providerErrorCode ?? null;
    this.providerErrorMessage = details.providerErrorMessage ?? null;
    this.httpStatus = details.httpStatus ?? null;
    this.retryable = details.retryable;
    this.correlationId = details.correlationId;
    this.rawResponse = details.rawResponse;
    if (details.cause !== undefined) {
      this.cause = details.cause;
    }
  }
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}
