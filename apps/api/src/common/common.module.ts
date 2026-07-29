import { Global, Module } from '@nestjs/common';

import { AppConfigModule } from './config/app-config.module';
import { LoggerModule } from './logger/logger.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { RequestContextModule } from './request-context/request-context.module';
import { AuthGuard } from './guards/auth.guard';
import { IpRateLimitGuard } from './guards/ip-rate-limit.guard';
import { RolesGuard } from './guards/roles.guard';
import { TenantAccessGuard } from './guards/tenant-access.guard';

/**
 * Aggregates cross-cutting infrastructure used by feature modules.
 */
@Global()
@Module({
  imports: [
    AppConfigModule,
    LoggerModule,
    PrismaModule,
    RedisModule,
    RequestContextModule,
  ],
  providers: [AuthGuard, RolesGuard, TenantAccessGuard, IpRateLimitGuard],
  exports: [
    AppConfigModule,
    LoggerModule,
    PrismaModule,
    RedisModule,
    RequestContextModule,
    AuthGuard,
    RolesGuard,
    TenantAccessGuard,
    IpRateLimitGuard,
  ],
})
export class CommonModule {}
