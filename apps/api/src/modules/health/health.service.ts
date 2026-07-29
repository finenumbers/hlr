import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { HealthLiveResponse, HealthReadyResponse, HealthStatus } from '@finenumbers/contracts';

import { ErrorCodes } from '../../common/errors/error-codes';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  live(): HealthLiveResponse {
    return {
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
    };
  }

  async ready(): Promise<HealthReadyResponse> {
    const checks: HealthReadyResponse['checks'] = [];

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.push({ name: 'postgres', status: 'ok' });
    } catch (error) {
      checks.push({
        name: 'postgres',
        status: 'down',
        detail: error instanceof Error ? error.message : 'unknown error',
      });
    }

    try {
      const pong = await this.redis.ping();
      checks.push({
        name: 'redis',
        status: pong === 'PONG' ? 'ok' : 'degraded',
        detail: pong,
      });
    } catch (error) {
      checks.push({
        name: 'redis',
        status: 'down',
        detail: error instanceof Error ? error.message : 'unknown error',
      });
    }

    const status = summarizeStatus(checks.map((check) => check.status));
    const body: HealthReadyResponse = {
      status,
      service: 'api',
      timestamp: new Date().toISOString(),
      checks,
    };

    if (status === 'down') {
      throw new ServiceUnavailableException({
        errorCode: ErrorCodes.SERVICE_UNAVAILABLE,
        message: 'Service unavailable',
        details: body,
      });
    }

    return body;
  }
}

function summarizeStatus(statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes('down')) {
    return 'down';
  }
  if (statuses.includes('degraded')) {
    return 'degraded';
  }
  return 'ok';
}
