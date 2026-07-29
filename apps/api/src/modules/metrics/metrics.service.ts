import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';

import { AppConfigService } from '../../common/config/app-config.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new Registry();

  readonly httpRequestsTotal: Counter<string>;
  readonly httpRequestDurationSeconds: Histogram<string>;
  readonly rateLimitHitsTotal: Counter<string>;
  readonly dbUp: Gauge<string>;
  readonly redisUp: Gauge<string>;

  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    this.registry.setDefaultLabels({
      service: 'api',
      env: this.config.nodeEnv,
    });

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total HTTP requests by route and status class',
      labelNames: ['method', 'route', 'status_code', 'status_class'],
      registers: [this.registry],
    });

    this.httpRequestDurationSeconds = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency in seconds',
      labelNames: ['method', 'route', 'status_class'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.rateLimitHitsTotal = new Counter({
      name: 'rate_limit_hits_total',
      help: 'Rate limit denials by zone/scope',
      labelNames: ['scope'],
      registers: [this.registry],
    });

    this.dbUp = new Gauge({
      name: 'app_db_up',
      help: '1 if Postgres responds to SELECT 1',
      registers: [this.registry],
    });

    this.redisUp = new Gauge({
      name: 'app_redis_up',
      help: '1 if Redis responds to PING',
      registers: [this.registry],
    });
  }

  onModuleInit(): void {
    if (!this.config.metricsEnabled) {
      return;
    }
    collectDefaultMetrics({ register: this.registry });
  }

  observeHttp(input: {
    method: string;
    route: string;
    statusCode: number;
    durationSeconds: number;
  }): void {
    if (!this.config.metricsEnabled) {
      return;
    }
    const statusClass = statusClassOf(input.statusCode);
    const route = lowCardinalityRoute(input.route);
    this.httpRequestsTotal.inc({
      method: input.method,
      route,
      status_code: String(input.statusCode),
      status_class: statusClass,
    });
    this.httpRequestDurationSeconds.observe(
      {
        method: input.method,
        route,
        status_class: statusClass,
      },
      input.durationSeconds,
    );
  }

  recordRateLimit(scope: string): void {
    if (!this.config.metricsEnabled) {
      return;
    }
    this.rateLimitHitsTotal.inc({ scope });
  }

  async refreshDependencyGauges(): Promise<void> {
    if (!this.config.metricsEnabled) {
      return;
    }
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      this.dbUp.set(1);
    } catch {
      this.dbUp.set(0);
    }
    try {
      const pong = await this.redis.ping();
      this.redisUp.set(pong === 'PONG' ? 1 : 0);
    } catch {
      this.redisUp.set(0);
    }
  }

  async render(): Promise<string> {
    if (this.config.metricsEnabled) {
      await this.refreshDependencyGauges();
    }
    return this.registry.metrics();
  }
}

function statusClassOf(statusCode: number): '2xx' | '3xx' | '4xx' | '5xx' | 'other' {
  if (statusCode >= 200 && statusCode < 300) {
    return '2xx';
  }
  if (statusCode >= 300 && statusCode < 400) {
    return '3xx';
  }
  if (statusCode >= 400 && statusCode < 500) {
    return '4xx';
  }
  if (statusCode >= 500 && statusCode < 600) {
    return '5xx';
  }
  return 'other';
}

/** Collapse dynamic path segments to keep Prometheus cardinality bounded. */
export function lowCardinalityRoute(route: string): string {
  const pathOnly = route.split('?')[0] ?? route;
  return pathOnly
    .split('/')
    .map((segment) => {
      if (!segment) {
        return segment;
      }
      if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) {
        return ':id';
      }
      if (/^c[a-z0-9]{18,}$/i.test(segment)) {
        return ':id';
      }
      if (/^\d+$/.test(segment)) {
        return ':id';
      }
      if (/^fnk_[a-z0-9_]+$/i.test(segment)) {
        return ':key';
      }
      return segment;
    })
    .join('/');
}
