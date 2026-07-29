import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

import { MetricsService } from '../../modules/metrics/metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const started = process.hrtime.bigint();
    const route = normalizeRoute(request);

    // Skip scraping itself from request cardinality noise (still counted lightly).
    if (route === '/metrics') {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: () => {
          this.record(request.method, route, response.statusCode, started);
        },
        error: (error: unknown) => {
          const status =
            typeof error === 'object' &&
            error !== null &&
            'getStatus' in error &&
            typeof (error as { getStatus: () => number }).getStatus === 'function'
              ? (error as { getStatus: () => number }).getStatus()
              : response.statusCode || 500;
          this.record(request.method, route, status, started);
        },
      }),
    );
  }

  private record(
    method: string,
    route: string,
    statusCode: number,
    started: bigint,
  ): void {
    const durationSeconds = Number(process.hrtime.bigint() - started) / 1e9;
    this.metrics.observeHttp({
      method,
      route,
      statusCode,
      durationSeconds,
    });
  }
}

function normalizeRoute(request: Request): string {
  const layerPath = (request as Request & { route?: { path?: string } }).route
    ?.path;
  if (typeof layerPath === 'string' && layerPath.length > 0) {
    const base = request.baseUrl ?? '';
    return `${base}${layerPath}`.replace(/\/+/g, '/') || '/';
  }
  const raw = request.originalUrl ?? request.url ?? '/';
  return raw.split('?')[0] || '/';
}
