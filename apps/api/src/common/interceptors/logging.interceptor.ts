import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

import { AppLogger } from '../logger/app-logger.service';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger: AppLogger;

  constructor(logger: AppLogger) {
    this.logger = logger.child(LoggingInterceptor.name);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const started = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.log({
            msg: 'http_request',
            method: request.method,
            path: request.originalUrl ?? request.url,
            statusCode: response.statusCode,
            durationMs: Date.now() - started,
          });
        },
        error: () => {
          this.logger.warn({
            msg: 'http_request_error',
            method: request.method,
            path: request.originalUrl ?? request.url,
            statusCode: response.statusCode,
            durationMs: Date.now() - started,
          });
        },
      }),
    );
  }
}
