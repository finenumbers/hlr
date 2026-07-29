import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';

import { ApiErrorEnvelopeDto } from '../errors/error-response.dto';

/** Standard error responses for public `/v1` OpenAPI docs. */
export function ApiStandardErrors() {
  return applyDecorators(
    ApiResponse({
      status: 400,
      description: 'Validation failed',
      type: ApiErrorEnvelopeDto,
    }),
    ApiResponse({
      status: 401,
      description: 'API key missing, invalid, revoked, or expired',
      type: ApiErrorEnvelopeDto,
    }),
    ApiResponse({
      status: 402,
      description: 'Insufficient funds',
      type: ApiErrorEnvelopeDto,
    }),
    ApiResponse({
      status: 404,
      description: 'Resource not found (or cross-tenant)',
      type: ApiErrorEnvelopeDto,
    }),
    ApiResponse({
      status: 409,
      description: 'Conflict (e.g. idempotency key reuse)',
      type: ApiErrorEnvelopeDto,
    }),
    ApiResponse({
      status: 429,
      description: 'Rate limited',
      type: ApiErrorEnvelopeDto,
    }),
  );
}
