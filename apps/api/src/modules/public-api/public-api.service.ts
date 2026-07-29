import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../../common/config/app-config.service';
import { RequestContextService } from '../../common/request-context/request-context.service';
import type { AuthenticatedApiKey } from '../../common/types/authenticated-api-key';
import { PrismaService } from '../../common/prisma/prisma.service';
import { resolveZoneRpm } from '../../common/rate-limit/resolve-zone-rpm';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { JobsService } from '../jobs/jobs.service';
import { resolveLimits } from '../settings/resolve-limits';
import { WalletsService } from '../wallets/wallets.service';
import type { SubmitBulkDto } from './dto/submit-bulk.dto';
import type { SubmitCheckDto } from './dto/submit-check.dto';
import type { PublicJobResponseDto } from './dto/public-job-response.dto';

@Injectable()
export class PublicApiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly wallets: WalletsService,
    private readonly idempotency: IdempotencyService,
    private readonly config: AppConfigService,
    private readonly requestContext: RequestContextService,
  ) {}

  async getMe(apiKey: AuthenticatedApiKey) {
    const [tenant, limits] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: apiKey.tenantId },
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
        },
      }),
      resolveLimits(this.prisma, {
        tenantId: apiKey.tenantId,
        apiKeyRateLimitRpm: apiKey.rateLimitRpm,
      }),
    ]);

    const zoneConfig = {
      submitRpm: limits.rateLimitRpm,
      readMultiplier: this.config.rateLimitReadMultiplier,
      readRpmMax: this.config.rateLimitReadRpmMax,
      webhookRpm: this.config.rateLimitWebhookRpm,
      webhookMultiplier: this.config.rateLimitWebhookMultiplier,
    };

    return {
      tenant,
      apiKey: {
        id: apiKey.apiKeyId,
        name: apiKey.name,
        prefix: apiKey.prefix,
        scopes: apiKey.scopes,
      },
      limits: {
        /** Canonical submit-zone RPM (key → tenant → platform). */
        rateLimitRpm: limits.rateLimitRpm,
        rateLimitZones: {
          submit: resolveZoneRpm('submit', zoneConfig),
          read: resolveZoneRpm('read', zoneConfig),
          webhook: resolveZoneRpm('webhook', zoneConfig),
        },
        maxBatchPhones: limits.maxBatchPhones,
        maxCsvRows: limits.maxCsvRows,
        maxCsvBytes: limits.maxCsvBytes,
        maxPageSize: 100,
        bodyLimit: this.config.bodyLimit,
        bodyLimitSubmit: this.config.bodyLimitSubmit,
      },
    };
  }

  async getBalance(tenantId: string) {
    const wallet = await this.wallets.getByTenantId(tenantId);
    return {
      currency: wallet.currency,
      availableBalance: wallet.availableBalance,
      heldBalance: wallet.heldBalance,
      updatedAt: wallet.updatedAt,
    };
  }

  async getUsageSummary(tenantId: string) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [jobAgg, itemAgg, debitAgg] = await Promise.all([
      this.prisma.job.aggregate({
        where: { tenantId, createdAt: { gte: since } },
        _count: { _all: true },
        _sum: { itemCount: true, successCount: true, failureCount: true },
      }),
      this.prisma.jobItem.groupBy({
        by: ['checkType', 'status'],
        where: { tenantId, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.walletTransaction.aggregate({
        where: {
          tenantId,
          type: 'DEBIT',
          createdAt: { gte: since },
        },
        _sum: { amount: true },
      }),
    ]);

    return {
      period: { from: since.toISOString(), to: new Date().toISOString() },
      jobs: {
        count: jobAgg._count._all,
        itemCount: jobAgg._sum.itemCount ?? 0,
        successCount: jobAgg._sum.successCount ?? 0,
        failureCount: jobAgg._sum.failureCount ?? 0,
      },
      itemsByTypeStatus: itemAgg.map((row) => ({
        checkType: row.checkType,
        status: row.status,
        count: row._count._all,
      })),
      spent: {
        amount: debitAgg._sum.amount?.toString() ?? '0',
      },
    };
  }

  async submitCheck(input: {
    apiKey: AuthenticatedApiKey;
    dto: SubmitCheckDto;
    idempotencyKey?: string;
    path: string;
  }): Promise<{ statusCode: number; body: PublicJobResponseDto }> {
    return this.createJobWithIdempotency({
      apiKey: input.apiKey,
      path: input.path,
      body: input.dto,
      idempotencyKey: input.idempotencyKey,
      checkType: input.dto.type === 'hlr' ? 'HLR' : 'PING',
      source: 'API',
      phones: [input.dto.phone],
    });
  }

  async submitBulk(input: {
    apiKey: AuthenticatedApiKey;
    dto: SubmitBulkDto;
    idempotencyKey?: string;
    path: string;
  }): Promise<{ statusCode: number; body: PublicJobResponseDto }> {
    return this.createJobWithIdempotency({
      apiKey: input.apiKey,
      path: input.path,
      body: input.dto,
      idempotencyKey: input.idempotencyKey,
      checkType: input.dto.type === 'hlr' ? 'HLR' : 'PING',
      source: 'BULK',
      phones: input.dto.phones,
    });
  }

  private async createJobWithIdempotency(input: {
    apiKey: AuthenticatedApiKey;
    path: string;
    body: unknown;
    idempotencyKey?: string;
    checkType: 'HLR' | 'PING';
    source: 'API' | 'BULK';
    phones: string[];
  }): Promise<{ statusCode: number; body: PublicJobResponseDto }> {
    const requestHash = this.idempotency.hashRequest({
      method: 'POST',
      path: input.path,
      body: input.body,
    });

    if (input.idempotencyKey) {
      const gate = await this.idempotency.beginOrReplay({
        tenantId: input.apiKey.tenantId,
        key: input.idempotencyKey,
        requestHash,
      });
      if (gate.kind === 'replay') {
        return {
          statusCode: gate.replay.responseCode,
          body: gate.replay.responseBody as PublicJobResponseDto,
        };
      }
    }

    const result = await this.jobs.create({
      tenantId: input.apiKey.tenantId,
      checkType: input.checkType,
      source: input.source,
      phones: input.phones,
      idempotencyKey: input.idempotencyKey,
      apiKeyId: input.apiKey.apiKeyId,
      requestId: this.requestContext.requestId,
    });

    const body: PublicJobResponseDto = {
      id: result.job.id,
      checkType: result.job.checkType,
      status: result.job.status,
      itemCount: result.job.itemCount,
      successCount: result.job.successCount,
      failureCount: result.job.failureCount,
      estimatedCost:
        result.job.estimatedCost === null || result.job.estimatedCost === undefined
          ? null
          : String(result.job.estimatedCost),
      actualCost:
        result.job.actualCost === null || result.job.actualCost === undefined
          ? null
          : String(result.job.actualCost),
      currency: result.job.currency,
      createdAt: result.job.createdAt,
      progress: result.progress,
    };

    if (input.idempotencyKey) {
      await this.idempotency.commit({
        tenantId: input.apiKey.tenantId,
        key: input.idempotencyKey,
        requestHash,
        responseCode: 202,
        responseBody: body,
      });
    }

    return { statusCode: 202, body };
  }

  mapJob(job: {
    id: string;
    checkType: string;
    status: string;
    itemCount: number;
    successCount: number;
    failureCount: number;
    estimatedCost: string | null;
    actualCost: string | null;
    currency: string;
    createdAt: Date;
    progress?: PublicJobResponseDto['progress'];
  }): PublicJobResponseDto {
    return {
      id: job.id,
      checkType: job.checkType,
      status: job.status,
      itemCount: job.itemCount,
      successCount: job.successCount,
      failureCount: job.failureCount,
      estimatedCost: job.estimatedCost,
      actualCost: job.actualCost,
      currency: job.currency,
      createdAt: job.createdAt,
      ...(job.progress ? { progress: job.progress } : {}),
    };
  }
}
