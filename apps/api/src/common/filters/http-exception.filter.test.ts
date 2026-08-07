import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ErrorCodes } from '../errors/error-codes';
import { AppLogger } from '../logger/app-logger.service';
import { RequestContextService } from '../request-context/request-context.service';
import { HttpExceptionFilter } from './http-exception.filter';

function createFilter(requestId?: string) {
  const requestContext = {
    requestId,
  } as RequestContextService;

  const logger = {
    child: () => ({
      error: vi.fn(),
      warn: vi.fn(),
      log: vi.fn(),
      debug: vi.fn(),
    }),
  } as unknown as AppLogger;

  return new HttpExceptionFilter(requestContext, logger);
}

function catchJson(filter: HttpExceptionFilter, exception: unknown) {
  let status = 0;
  let body: unknown;
  const headers: Record<string, string> = {};
  const response = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
  };

  filter.catch(exception, {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: 'GET', originalUrl: '/v1/checks' }),
    }),
  } as never);

  return { status, body, headers };
}

describe('HttpExceptionFilter error envelope', () => {
  it('returns code, message, and requestId for domain HttpExceptions', () => {
    const filter = createFilter('req-123');
    const { status, body } = catchJson(
      filter,
      new NotFoundException({
        errorCode: ErrorCodes.NOT_FOUND,
        message: 'Job abc not found',
      }),
    );

    expect(status).toBe(404);
    expect(body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Job abc not found',
        requestId: 'req-123',
      },
    });
  });

  it('always includes requestId even when ALS context is missing', () => {
    const filter = createFilter(undefined);
    const { body, headers } = catchJson(
      filter,
      new UnauthorizedException({
        errorCode: ErrorCodes.UNAUTHORIZED,
        message: 'Invalid API key',
      }),
    );

    const envelope = body as { error: { requestId: string; code: string } };
    expect(envelope.error.code).toBe('UNAUTHORIZED');
    expect(envelope.error.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(headers['x-request-id']).toBe(envelope.error.requestId);
  });

  it('normalizes Nest ValidationPipe array messages', () => {
    const filter = createFilter('req-val');
    const { status, body } = catchJson(
      filter,
      new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: ['phone must be a string', 'type must be one of: hlr, ping'],
      }),
    );

    expect(status).toBe(400);
    expect(body).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'phone must be a string; type must be one of: hlr, ping',
        requestId: 'req-val',
        details: ['phone must be a string', 'type must be one of: hlr, ping'],
      },
    });
  });

  it('preserves machine-readable codes for 402/409/429', () => {
    const filter = createFilter('req-codes');

    expect(
      catchJson(
        filter,
        new HttpException(
          { errorCode: ErrorCodes.INSUFFICIENT_FUNDS, message: 'No funds' },
          HttpStatus.PAYMENT_REQUIRED,
        ),
      ).body,
    ).toMatchObject({
      error: { code: 'INSUFFICIENT_FUNDS', requestId: 'req-codes' },
    });

    expect(
      catchJson(
        filter,
        new ConflictException({
          errorCode: ErrorCodes.IDEMPOTENCY_KEY_REUSE,
          message: 'Key reuse',
        }),
      ).body,
    ).toMatchObject({
      error: { code: 'IDEMPOTENCY_KEY_REUSE', requestId: 'req-codes' },
    });

    expect(
      catchJson(
        filter,
        new HttpException(
          { errorCode: ErrorCodes.RATE_LIMITED, message: 'Slow down' },
          HttpStatus.TOO_MANY_REQUESTS,
        ),
      ).body,
    ).toMatchObject({
      error: { code: 'RATE_LIMITED', requestId: 'req-codes' },
    });
  });

  it('maps unexpected errors to INTERNAL_ERROR without leaking internals', () => {
    const filter = createFilter('req-500');
    const { status, body } = catchJson(filter, new Error('secret db url leaked'));

    expect(status).toBe(500);
    expect(body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        requestId: 'req-500',
      },
    });
  });

  it('maps missing csv_previews Prisma error to SERVICE_UNAVAILABLE', () => {
    const filter = createFilter('req-mig');
    const err = Object.assign(
      new Error('The table `public.csv_previews` does not exist in the current database.'),
      { code: 'P2021', name: 'PrismaClientKnownRequestError' },
    );
    const { status, body } = catchJson(filter, err);
    expect(status).toBe(503);
    expect(body).toMatchObject({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: expect.stringContaining('csv_previews'),
        requestId: 'req-mig',
      },
    });
  });

  it('maps EACCES upload errors to SERVICE_UNAVAILABLE', () => {
    const filter = createFilter('req-fs');
    const err = Object.assign(new Error('EACCES: permission denied, mkdir'), {
      code: 'EACCES',
    });
    const { status, body } = catchJson(filter, err);
    expect(status).toBe(503);
    expect(body).toMatchObject({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: expect.stringContaining('Upload storage'),
        requestId: 'req-fs',
      },
    });
  });

  it('maps Redis / BullMQ errors to SERVICE_UNAVAILABLE', () => {
    const filter = createFilter('req-redis');
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), {
      code: 'ECONNREFUSED',
    });
    expect(catchJson(filter, refused)).toMatchObject({
      status: 503,
      body: {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: expect.stringContaining('Job queue'),
          requestId: 'req-redis',
        },
      },
    });

    expect(
      catchJson(filter, new Error('BullMQ queue jobs-submit is not initialized')),
    ).toMatchObject({
      status: 503,
      body: {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: expect.stringContaining('Job queue'),
        },
      },
    });
  });
});
