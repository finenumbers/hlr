import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestContextService } from '../../common/request-context/request-context.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import type { CreateApiKeyDto } from '../api-keys/dto/create-api-key.dto';
import { NestBillingService } from '../billing/billing.service';
import { JobsService } from '../jobs/jobs.service';
import { WalletsService } from '../wallets/wallets.service';
import type { CreateWebhookDto } from '../webhooks/dto/create-webhook.dto';
import type { UpdateWebhookDto } from '../webhooks/dto/update-webhook.dto';
import { WebhooksService } from '../webhooks/webhooks.service';

@Injectable()
export class CabinetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletsService,
    private readonly billing: NestBillingService,
    private readonly jobs: JobsService,
    private readonly apiKeys: ApiKeysService,
    private readonly webhooks: WebhooksService,
    private readonly requestContext: RequestContextService,
  ) {}

  async dashboard(tenantId: string) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [wallet, recentJobs, jobAgg, itemAgg] = await Promise.all([
      this.wallets.getByTenantId(tenantId),
      this.jobs.listByTenant(tenantId, 1, 5),
      this.prisma.job.aggregate({
        where: { tenantId, createdAt: { gte: since } },
        _count: { _all: true },
        _sum: { itemCount: true, successCount: true, failureCount: true },
      }),
      this.prisma.jobItem.groupBy({
        by: ['checkType'],
        where: { tenantId, createdAt: { gte: since } },
        _count: { _all: true },
      }),
    ]);

    return {
      balance: wallet,
      recentJobs: recentJobs.items,
      usage: {
        period: { from: since.toISOString(), to: new Date().toISOString() },
        jobs: jobAgg._count._all,
        itemCount: jobAgg._sum.itemCount ?? 0,
        successCount: jobAgg._sum.successCount ?? 0,
        failureCount: jobAgg._sum.failureCount ?? 0,
        hlrCount: itemAgg.find((r) => r.checkType === 'HLR')?._count._all ?? 0,
        pingCount: itemAgg.find((r) => r.checkType === 'PING')?._count._all ?? 0,
      },
    };
  }

  estimate(tenantId: string, checkType: 'HLR' | 'PING', unitCount: number) {
    return this.billing.estimate({ tenantId, checkType, unitCount });
  }

  createJob(input: {
    tenantId: string;
    checkType: 'HLR' | 'PING';
    phones: string[];
    source: 'SINGLE' | 'BULK';
    createdByUserId: string;
    idempotencyKey?: string;
  }) {
    return this.jobs.create({
      tenantId: input.tenantId,
      checkType: input.checkType,
      source: input.source,
      phones: input.phones,
      createdByUserId: input.createdByUserId,
      idempotencyKey: input.idempotencyKey,
      requestId: this.requestContext.requestId,
    });
  }

  createJobFromCsv(input: {
    tenantId: string;
    checkType: 'HLR' | 'PING';
    file: { path: string; originalname: string; size: number };
    createdByUserId: string;
    idempotencyKey?: string;
  }) {
    return this.jobs.createFromCsvUpload({
      tenantId: input.tenantId,
      checkType: input.checkType,
      file: input.file,
      createdByUserId: input.createdByUserId,
      idempotencyKey: input.idempotencyKey,
      requestId: this.requestContext.requestId,
    });
  }

  listJobs(
    tenantId: string,
    page: number,
    pageSize: number,
    filters?: { status?: string; checkType?: string },
  ) {
    return this.jobs.listByTenant(tenantId, page, pageSize, filters);
  }

  getJob(tenantId: string, id: string) {
    return this.jobs.getByIdForTenant(tenantId, id);
  }

  listJobItems(
    tenantId: string,
    jobId: string,
    page: number,
    pageSize: number,
    status?: string,
  ) {
    return this.jobs.listItemsForTenant({
      tenantId,
      jobId,
      page,
      pageSize,
      status,
    });
  }

  getBalance(tenantId: string) {
    return this.wallets.getByTenantId(tenantId);
  }

  listLedger(tenantId: string) {
    return this.billing.listLedger(tenantId);
  }

  async getTariff(tenantId: string) {
    const rows = await this.prisma.tenantTariff.findMany({
      where: { tenantId },
      include: { tariffPlan: true },
    });
    const mapOne = (checkType: 'HLR' | 'PING') => {
      const row = rows.find((r) => r.checkType === checkType);
      if (!row) {
        return null;
      }
      return {
        checkType,
        tariffPlanId: row.tariffPlanId,
        code: row.tariffPlan.code,
        name: row.tariffPlan.name,
        currency: row.tariffPlan.currency,
        sellPrice: (row.priceOverride ?? row.tariffPlan.sellPrice).toString(),
      };
    };
    return {
      hlr: mapOne('HLR'),
      ping: mapOne('PING'),
    };
  }

  listApiKeys(tenantId: string, page: number, pageSize: number) {
    return this.apiKeys.listByTenant(tenantId, page, pageSize);
  }

  createApiKey(
    tenantId: string,
    dto: CreateApiKeyDto,
    actorUserId: string,
    meta?: { ip?: string | null; userAgent?: string | null },
  ) {
    return this.apiKeys.createForTenant({
      tenantId,
      dto,
      actorUserId,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
    });
  }

  rotateApiKey(
    tenantId: string,
    id: string,
    actorUserId: string,
    meta?: { ip?: string | null; userAgent?: string | null },
  ) {
    return this.apiKeys.rotateForTenant({
      tenantId,
      id,
      actorUserId,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
    });
  }

  revokeApiKey(
    tenantId: string,
    id: string,
    actorUserId: string,
    meta?: { ip?: string | null; userAgent?: string | null },
  ) {
    return this.apiKeys.revokeForTenant({
      tenantId,
      id,
      actorUserId,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
    });
  }

  listWebhooks(tenantId: string, page: number, pageSize: number) {
    return this.webhooks.listByTenant(tenantId, page, pageSize);
  }

  createWebhook(
    tenantId: string,
    dto: CreateWebhookDto,
    actorUserId: string,
    meta?: { ip?: string | null; userAgent?: string | null },
  ) {
    return this.webhooks.createForTenant({
      tenantId,
      dto,
      actorUserId,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
    });
  }

  updateWebhook(
    tenantId: string,
    id: string,
    dto: UpdateWebhookDto,
    actorUserId: string,
    meta?: { ip?: string | null; userAgent?: string | null },
  ) {
    return this.webhooks.updateForTenant({
      tenantId,
      id,
      dto,
      actorUserId,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
    });
  }

  rotateWebhookSecret(
    tenantId: string,
    id: string,
    actorUserId: string,
    meta?: { ip?: string | null; userAgent?: string | null },
  ) {
    return this.webhooks.rotateSecretForTenant({
      tenantId,
      id,
      actorUserId,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
    });
  }

  deleteWebhook(
    tenantId: string,
    id: string,
    actorUserId: string,
    meta?: { ip?: string | null; userAgent?: string | null },
  ) {
    return this.webhooks.deleteForTenant({
      tenantId,
      id,
      actorUserId,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
    });
  }

  listDeliveries(
    tenantId: string,
    page: number,
    pageSize: number,
    filters?: { endpointId?: string; status?: string },
  ) {
    return this.webhooks.listDeliveriesForTenant({
      tenantId,
      page,
      pageSize,
      endpointId: filters?.endpointId,
      status: filters?.status,
    });
  }

  async webhookSummary(tenantId: string) {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.webhookDelivery.groupBy({
      by: ['status'],
      where: { tenantId, createdAt: { gte: since } },
      _count: { _all: true },
    });
    const counts = {
      PENDING: 0,
      DELIVERING: 0,
      SUCCEEDED: 0,
      FAILED: 0,
      DEAD: 0,
    };
    for (const row of rows) {
      counts[row.status] = row._count._all;
    }
    return {
      period: { from: since.toISOString(), to: new Date().toISOString() },
      counts,
    };
  }
}
