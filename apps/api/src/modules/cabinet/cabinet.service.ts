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
import {
  toCabinetJobView,
  toCabinetLedgerEntry,
  toCabinetSellEstimate,
} from './cabinet-client-view';

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
    const [wallet, recentJobs, jobByType, products] = await Promise.all([
      this.wallets.getByTenantId(tenantId),
      this.jobs.listByTenant(tenantId, 1, 5),
      this.prisma.job.groupBy({
        by: ['checkType'],
        where: { tenantId, createdAt: { gte: since } },
        _count: { _all: true },
        _sum: { itemCount: true, successCount: true, failureCount: true },
      }),
      this.getTariff(tenantId),
    ]);

    const usageFor = (checkType: 'HLR' | 'PING') => {
      const row = jobByType.find((r) => r.checkType === checkType);
      return {
        jobs: row?._count._all ?? 0,
        itemCount: row?._sum.itemCount ?? 0,
        successCount: row?._sum.successCount ?? 0,
        failureCount: row?._sum.failureCount ?? 0,
      };
    };

    const hlr = usageFor('HLR');
    const ping = usageFor('PING');

    return {
      balance: wallet,
      recentJobs: recentJobs.items,
      products,
      usage: {
        period: { from: since.toISOString(), to: new Date().toISOString() },
        hlr,
        ping,
        // Legacy totals (sum of products) — prefer hlr/ping in UI.
        jobs: hlr.jobs + ping.jobs,
        itemCount: hlr.itemCount + ping.itemCount,
        successCount: hlr.successCount + ping.successCount,
        failureCount: hlr.failureCount + ping.failureCount,
        hlrCount: hlr.itemCount,
        pingCount: ping.itemCount,
      },
    };
  }

  async estimate(tenantId: string, checkType: 'HLR' | 'PING', unitCount: number) {
    const estimate = await this.billing.estimate({ tenantId, checkType, unitCount });
    return toCabinetSellEstimate(estimate);
  }

  async createJob(input: {
    tenantId: string;
    checkType: 'HLR' | 'PING';
    phones: string[];
    source: 'SINGLE' | 'BULK';
    createdByUserId: string;
    idempotencyKey?: string;
  }) {
    const result = await this.jobs.create({
      tenantId: input.tenantId,
      checkType: input.checkType,
      source: input.source,
      phones: input.phones,
      createdByUserId: input.createdByUserId,
      idempotencyKey: input.idempotencyKey,
      requestId: this.requestContext.requestId,
    });
    return {
      ...result,
      job: toCabinetJobView(result.job),
    };
  }

  async createJobFromCsv(input: {
    tenantId: string;
    checkType: 'HLR' | 'PING';
    file: { path: string; originalname: string; size: number };
    createdByUserId: string;
    idempotencyKey?: string;
  }) {
    const result = await this.jobs.createFromCsvUpload({
      tenantId: input.tenantId,
      checkType: input.checkType,
      file: input.file,
      createdByUserId: input.createdByUserId,
      idempotencyKey: input.idempotencyKey,
      requestId: this.requestContext.requestId,
    });
    return {
      ...result,
      job: toCabinetJobView(result.job),
    };
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

  async listLedger(tenantId: string) {
    const rows = await this.billing.listLedger(tenantId);
    return rows.map(toCabinetLedgerEntry);
  }

  /**
   * Billable product prices for the cabinet — same resolver as estimate/submit
   * (effective window + active plan). Missing/invalid assignment → null.
   */
  async getTariff(tenantId: string) {
    const quotes = await this.billing.quoteProducts(tenantId);
    const mapOne = (quote: Awaited<ReturnType<NestBillingService['quoteProduct']>>) => {
      if (!quote) {
        return null;
      }
      return {
        checkType: quote.checkType,
        tariffPlanId: quote.tariffPlanId,
        code: quote.tariffPlanCode,
        name: quote.tariffPlanName,
        currency: quote.currency,
        sellPrice: quote.unitSellPrice,
      };
    };
    return {
      hlr: mapOne(quotes.hlr),
      ping: mapOne(quotes.ping),
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
