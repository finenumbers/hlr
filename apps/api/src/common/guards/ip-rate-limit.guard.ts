import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';

import { AppConfigService } from '../config/app-config.service';
import { ErrorCodes } from '../errors/error-codes';
import { RedisService } from '../redis/redis.service';
import { MetricsService } from '../../modules/metrics/metrics.service';

export const IP_RATE_LIMIT_KEY = 'ipRateLimit';

export type IpRateLimitOptions = {
  /** Logical scope label for Redis key + metrics (e.g. auth_login). */
  scope: string;
  /** Override RPM; otherwise resolved from config by scope. */
  rpm?: number;
};

/** Attach per-IP fixed-window rate limit to a handler. */
export const IpRateLimit = (options: IpRateLimitOptions) =>
  SetMetadata(IP_RATE_LIMIT_KEY, options);

/**
 * Redis fixed-window limiter by client IP (auth zone).
 * Fail-open on Redis errors (same posture as API-key RPM).
 */
@Injectable()
export class IpRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
    private readonly metrics: MetricsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<IpRateLimitOptions | undefined>(
      IP_RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!options) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const ip = clientIp(request);
    const rpm = options.rpm ?? this.resolveRpm(options.scope);

    const windowSec = 60;
    const window = Math.floor(Date.now() / 1000 / windowSec);
    const redisKey = `rpm:ip:${options.scope}:${ip}:${window}`;

    try {
      if (this.redis.client.status !== 'ready') {
        await this.redis.client.connect();
      }
      const count = await this.redis.client.incr(redisKey);
      if (count === 1) {
        await this.redis.client.expire(redisKey, windowSec);
      }

      response.setHeader('X-RateLimit-Limit', String(rpm));
      response.setHeader(
        'X-RateLimit-Remaining',
        String(Math.max(0, rpm - count)),
      );
      response.setHeader('X-RateLimit-Zone', 'auth');
      response.setHeader('X-RateLimit-Scope', options.scope);

      if (count > rpm) {
        this.metrics.recordRateLimit(options.scope);
        response.setHeader('Retry-After', String(windowSec));
        throw new HttpException(
          {
            errorCode: ErrorCodes.RATE_LIMITED,
            message: `Rate limit exceeded (${rpm} requests/minute)`,
            details: { scope: options.scope, zone: 'auth', rateLimitRpm: rpm },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      // Fail open on Redis errors.
    }

    return true;
  }

  private resolveRpm(scope: string): number {
    if (scope === 'auth_login') {
      return this.config.authLoginRpm;
    }
    if (scope === 'auth_logout') {
      return this.config.authLogoutRpm;
    }
    return this.config.ipRateLimitRpm;
  }
}

/**
 * Use Express `request.ip` (honors `trust proxy`). Never read raw X-Forwarded-For
 * leftmost — that is client-spoofable and bypasses login RPM.
 */
function clientIp(request: Request): string {
  return request.ip || request.socket.remoteAddress || 'unknown';
}
