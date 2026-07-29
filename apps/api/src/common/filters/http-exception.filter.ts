import { randomUUID } from 'node:crypto';

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  NotImplementedException,
} from '@nestjs/common';
import type { Response } from 'express';

import { ErrorCodes } from '../errors/error-codes';
import { buildErrorEnvelope } from '../errors/error-envelope';
import { AppLogger } from '../logger/app-logger.service';
import { RequestContextService } from '../request-context/request-context.service';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger: AppLogger;

  constructor(
    private readonly requestContext: RequestContextService,
    logger: AppLogger,
  ) {
    this.logger = logger.child(HttpExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    // Always emit requestId — clients rely on it for support/automation.
    const requestId = this.requestContext.requestId ?? randomUUID();
    if (!response.getHeader('x-request-id')) {
      response.setHeader('x-request-id', requestId);
    }

    const { status, code, message, details } = this.normalize(exception);
    const request = ctx.getRequest<{ method?: string; originalUrl?: string; url?: string }>();
    const errorFields = {
      msg: 'http_error',
      code,
      status,
      message,
      method: request?.method,
      path: request?.originalUrl ?? request?.url,
      requestId,
    };

    if (status >= 500) {
      this.logger.error(
        errorFields,
        exception instanceof Error ? exception.stack : undefined,
        HttpExceptionFilter.name,
      );
    } else {
      this.logger.warn(errorFields, HttpExceptionFilter.name);
    }

    response.status(status).json(
      buildErrorEnvelope({
        code,
        message,
        details,
        requestId,
      }),
    );
  }

  private normalize(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: unknown;
  } {
    if (exception instanceof NotImplementedException) {
      return {
        status: HttpStatus.NOT_IMPLEMENTED,
        code: ErrorCodes.NOT_IMPLEMENTED,
        message: this.extractMessage(exception.getResponse(), 'Not implemented'),
        details: this.extractDetails(exception.getResponse()),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      return {
        status,
        code: this.mapStatusToCode(status, body),
        message: this.extractMessage(body, exception.message),
        details: this.extractDetails(body),
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCodes.INTERNAL_ERROR,
      message: 'Internal server error',
    };
  }

  private mapStatusToCode(status: number, body: string | object): string {
    if (typeof body === 'object' && body !== null) {
      const record = body as { errorCode?: unknown; code?: unknown };
      // Prefer explicit machine codes from our throw sites.
      if (typeof record.errorCode === 'string' && record.errorCode.length > 0) {
        return record.errorCode;
      }
      // Ignore Nest's generic `{ error: 'Bad Request', code?: … }` string labels
      // unless they look like our SCREAMING_SNAKE codes.
      if (
        typeof record.code === 'string' &&
        /^[A-Z][A-Z0-9_]+$/.test(record.code)
      ) {
        return record.code;
      }
    }

    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCodes.VALIDATION_FAILED;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCodes.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ErrorCodes.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCodes.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCodes.CONFLICT;
      case HttpStatus.PAYMENT_REQUIRED:
        return ErrorCodes.INSUFFICIENT_FUNDS;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCodes.RATE_LIMITED;
      case HttpStatus.NOT_IMPLEMENTED:
        return ErrorCodes.NOT_IMPLEMENTED;
      case HttpStatus.SERVICE_UNAVAILABLE:
        return ErrorCodes.SERVICE_UNAVAILABLE;
      default:
        return status >= 500 ? ErrorCodes.INTERNAL_ERROR : `HTTP_${status}`;
    }
  }

  private extractMessage(body: string | object, fallback: string): string {
    if (typeof body === 'string') {
      return body;
    }
    if (typeof body === 'object' && body !== null) {
      const record = body as { message?: unknown };
      if (typeof record.message === 'string') {
        return record.message;
      }
      if (Array.isArray(record.message)) {
        return record.message.map(String).join('; ');
      }
    }
    return fallback;
  }

  private extractDetails(body: string | object): unknown {
    if (typeof body !== 'object' || body === null) {
      return undefined;
    }
    const record = body as { message?: unknown; details?: unknown };
    if (record.details !== undefined) {
      return record.details;
    }
    // Nest ValidationPipe puts field errors in `message: string[]`.
    if (Array.isArray(record.message)) {
      return record.message;
    }
    return undefined;
  }
}
