import type { ErrorCode } from './error-codes';

/**
 * Stable public error shape for all HTTP APIs (especially `/v1`).
 * Clients should key automation on `error.code` and correlate via `error.requestId`.
 */
export type ErrorEnvelope = {
  error: {
    code: ErrorCode | string;
    message: string;
    /** Always present — also echoed as `X-Request-Id` response header. */
    requestId: string;
    details?: unknown;
  };
};

export function buildErrorEnvelope(input: {
  code: ErrorCode | string;
  message: string;
  requestId: string;
  details?: unknown;
}): ErrorEnvelope {
  return {
    error: {
      code: input.code,
      message: input.message,
      requestId: input.requestId,
      ...(input.details !== undefined ? { details: input.details } : {}),
    },
  };
}
