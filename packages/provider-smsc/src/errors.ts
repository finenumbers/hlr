import { ProviderError } from '@finenumbers/provider-core';
import type { ProviderErrorKind } from '@finenumbers/provider-core';

import type { SmscErrorBody } from './types.js';

/**
 * SMSC send/status API error_code values (from SMSC HTTP docs).
 * 1 params, 2 auth, 3 funds, 4 IP, 5 date, 6 forbidden, 7 phone, 8 cannot deliver, 9 duplicate flood.
 */
export function mapSmscErrorCode(code: number | string | null | undefined): {
  kind: ProviderErrorKind;
  retryable: boolean;
} {
  const n = typeof code === 'string' ? Number(code) : code;
  switch (n) {
    case 2:
    case 4:
      return { kind: 'auth', retryable: false };
    case 3:
      return { kind: 'insufficient_funds', retryable: false };
    case 1:
    case 5:
    case 7:
      return { kind: 'validation', retryable: false };
    case 6:
    case 8:
      return { kind: 'provider', retryable: false };
    case 9:
      // Too many identical requests — treat as transient rate limit.
      return { kind: 'rate_limit', retryable: true };
    default:
      return { kind: 'provider', retryable: false };
  }
}

export function isSmscErrorBody(body: unknown): body is SmscErrorBody {
  if (!body || typeof body !== 'object') {
    return false;
  }
  return 'error_code' in body || ('error' in body && !('status' in body && 'id' in body));
}

export function smscErrorFromBody(
  body: SmscErrorBody,
  options: { correlationId?: string; httpStatus?: number } = {},
): ProviderError {
  const code = body.error_code ?? null;
  const mapped = mapSmscErrorCode(code);
  return new ProviderError({
    providerCode: 'smsc',
    kind: mapped.kind,
    message: body.error
      ? `Provider error ${code ?? '?'}: ${body.error}`
      : `Provider error_code=${code ?? 'unknown'}`,
    providerErrorCode: code,
    providerErrorMessage: body.error ?? null,
    httpStatus: options.httpStatus ?? null,
    retryable: mapped.retryable,
    correlationId: options.correlationId,
    rawResponse: body,
  });
}

export function assertNoSmscError(
  body: unknown,
  options: { correlationId?: string; httpStatus?: number } = {},
): void {
  if (!body || typeof body !== 'object') {
    return;
  }
  const record = body as SmscErrorBody;
  if (record.error_code !== undefined && record.error_code !== null && record.error_code !== '') {
    // Successful status payloads can include err (delivery) but not error_code.
    // error_code is the API-level failure marker.
    throw smscErrorFromBody(record, options);
  }
  if (record.error && record.id === undefined && !('status' in record)) {
    throw smscErrorFromBody(record, options);
  }
}
