import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';

import type { RequestWithApiKey } from '../decorators/current-api-key.decorator';
import { AppConfigService } from '../config/app-config.service';
import { ErrorCodes } from '../errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { MetricsService } from '../../modules/metrics/metrics.service';
import { resolveLimits } from '../../modules/settings/resolve-limits';
import {
  RATE_LIMIT_ZONE_KEY,
  type RateLimitZone,
} from '../rate-limit/rate-limit-zone';
import { resolveZoneRpm } from '../rate-limit/resolve-zone-rpm';

/**
 * Fixed-window RPM limiter keyed by API key id **and zone**.
 * Zones (submit / read / webhook) use independent Redis buckets so polling
 * does not consume submit quota (OWASP API abuse protection).
 */
@Injectable()
export class ApiKeyRateLimitGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
    private readonly config: AppConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithApiKey>();
    const response = context.switchToHttp().getResponse<Response>();
    const apiKey = request.apiKey;
    if (!apiKey) {
      return true;
    }

    const zone =
      this.reflector.getAllAndOverride<Exclude<RateLimitZone, 'auth'> | undefined>(
        RATE_LIMIT_ZONE_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? 'read';

    const limits = await resolveLimits(this.prisma, {
      tenantId: apiKey.tenantId,
      apiKeyRateLimitRpm: apiKey.rateLimitRpm,
    });

    const rpm = resolveZoneRpm(zone, {
      submitRpm: limits.rateLimitRpm,
      readMultiplier: this.config.rateLimitReadMultiplier,
      readRpmMax: this.config.rateLimitReadRpmMax,
      webhookRpm: this.config.rateLimitWebhookRpm,
      webhookMultiplier: this.config.rateLimitWebhookMultiplier,
    });

    const windowSec = 60;
    const window = Math.floor(Date.now() / 1000 / windowSec);
    const redisKey = `rpm:apikey:${zone}:${apiKey.apiKeyId}:${window}`;

    try {
      if (this.redis.client.status !== 'ready') {
        await this.redis.client.connect();
      }
      const count = await this.redis.client.incr(redisKey);
      if (count === 1) {
        await this.redis.client.expire(redisKey, windowSec);
      }

      const remaining = Math.max(0, rpm - count);
      response.setHeader('X-RateLimit-Limit', String(rpm));
      response.setHeader('X-RateLimit-Remaining', String(remaining));
      response.setHeader('X-RateLimit-Zone', zone);
      response.setHeader(
        'X-RateLimit-Reset',
        String((window + 1) * windowSec),
      );

      if (count > rpm) {
        this.metrics.recordRateLimit(`api_key_${zone}`);
        response.setHeader('Retry-After', String(windowSec));
        throw new HttpException(
          {
            errorCode: ErrorCodes.RATE_LIMITED,
            message: `Rate limit exceeded for zone "${zone}" (${rpm} requests/minute)`,
            details: {
              zone,
              rateLimitRpm: rpm,
              submitRateLimitRpm: limits.rateLimitRpm,
            },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      // Fail open on Redis errors — availability over hard deny.
    }

    return true;
  }
}
