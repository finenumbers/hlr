import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { TenantStatus } from '@finenumbers/db';

import { ErrorCodes } from '../../common/errors/error-codes';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NestBillingService } from '../billing/billing.service';
import { JobsService } from '../jobs/jobs.service';
import { ProviderSmscService } from '../provider-smsc/provider-smsc.service';
import { TariffsService } from '../tariffs/tariffs.service';
import { TenantsService } from '../tenants/tenants.service';
import { WalletsService } from '../wallets/wallets.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { ApiKeysService } from '../api-keys/api-keys.service';

@Injectable()
export class AdminPanelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
    private readonly wallets: WalletsService,
    private readonly tariffs: TariffsService,
    private readonly billing: NestBillingService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
    private readonly provider: ProviderSmscService,
    private readonly webhooks: WebhooksService,
    private readonly apiKeys: ApiKeysService,
  ) {}

  async dashboard() {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [
      tenantsTotal,
      tenantsActive,
      tenantsSuspended,
      jobsTotal,
      jobsByStatus,
      itemsByType,
      debitSum,
      providerFailed,
      providerTotal,
      webhookDead,
      stuckJobs,
      failedJobs,
    ] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({ where: { status: 'ACTIVE' } }),
      this.prisma.tenant.count({ where: { status: 'SUSPENDED' } }),
      this.prisma.job.count({ where: { createdAt: { gte: since24h } } }),
      this.prisma.job.groupBy({
        by: ['status'],
        where: { createdAt: { gte: since24h } },
        _count: { _all: true },
      }),
      this.prisma.jobItem.groupBy({
        by: ['checkType'],
        where: { createdAt: { gte: since24h } },
        _count: { _all: true },
      }),
      this.prisma.walletTransaction.aggregate({
        where: { type: 'DEBIT', createdAt: { gte: since24h } },
        _sum: { amount: true },
      }),
      this.prisma.providerRequest.count({
        where: { status: 'FAILED', createdAt: { gte: since24h } },
      }),
      this.prisma.providerRequest.count({
        where: { createdAt: { gte: since24h } },
      }),
      this.prisma.webhookDelivery.count({
        where: { status: 'DEAD', createdAt: { gte: since24h } },
      }),
      this.prisma.job.findMany({
        where: {
          status: { in: ['QUEUED', 'PROCESSING'] },
          updatedAt: { lte: new Date(Date.now() - 30 * 60 * 1000) },
        },
        orderBy: { updatedAt: 'asc' },
        take: 8,
        select: {
          id: true,
          tenantId: true,
          status: true,
          checkType: true,
          itemCount: true,
          failureCount: true,
          updatedAt: true,
          tenant: { select: { slug: true, name: true } },
        },
      }),
      this.prisma.job.findMany({
        where: {
          status: { in: ['FAILED', 'COMPLETED_WITH_ERRORS'] },
          createdAt: { gte: since24h },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          tenantId: true,
          status: true,
          checkType: true,
          itemCount: true,
          failureCount: true,
          createdAt: true,
          tenant: { select: { slug: true, name: true } },
        },
      }),
    ]);

    const hlr = itemsByType.find((r) => r.checkType === 'HLR')?._count._all ?? 0;
    const ping = itemsByType.find((r) => r.checkType === 'PING')?._count._all ?? 0;
    const providerErrorRate =
      providerTotal === 0 ? 0 : Number(((providerFailed / providerTotal) * 100).toFixed(2));

    const adapter = this.provider.getAdapterStatus();

    return {
      period: { from: since24h.toISOString(), to: new Date().toISOString() },
      health: {
        providerConfigured: adapter.configured,
        providerCode: adapter.providerCode,
        webhookDeadLetter24h: webhookDead,
        stuckJobs: stuckJobs.length,
        queue: Object.fromEntries(jobsByStatus.map((r) => [r.status, r._count._all])),
      },
      volume: {
        tenantsTotal,
        tenantsActive,
        tenantsSuspended,
        jobs24h: jobsTotal,
        hlrItems24h: hlr,
        pingItems24h: ping,
      },
      money: {
        capturedDebit24h: debitSum._sum.amount?.toString() ?? '0',
        currency: 'RUB',
      },
      problems: {
        providerErrorRatePct: providerErrorRate,
        providerFailed24h: providerFailed,
        stuckJobs,
        failedJobs,
      },
    };
  }

  async listTenants(page: number, pageSize: number, status?: string) {
    const skip = (page - 1) * pageSize;
    const where = status
      ? { status: status as TenantStatus }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.tenant.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          rateLimitRpm: true,
          wallet: {
            select: {
              availableBalance: true,
              heldBalance: true,
              currency: true,
            },
          },
          tenantTariff: {
            select: {
              tariffPlanId: true,
              tariffPlan: { select: { code: true, name: true } },
            },
          },
          _count: {
            select: { apiKeys: true, webhookEndpoints: true, jobs: true },
          },
        },
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return {
      items: items.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        status: t.status,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        rateLimitRpm: t.rateLimitRpm,
        wallet: t.wallet
          ? {
              availableBalance: t.wallet.availableBalance.toString(),
              heldBalance: t.wallet.heldBalance.toString(),
              currency: t.wallet.currency,
            }
          : null,
        tariff: t.tenantTariff
          ? {
              tariffPlanId: t.tenantTariff.tariffPlanId,
              code: t.tenantTariff.tariffPlan.code,
              name: t.tenantTariff.tariffPlan.name,
            }
          : null,
        counts: t._count,
      })),
      page,
      pageSize,
      total,
    };
  }

  async getTenant(id: string): Promise<Record<string, unknown>> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        rateLimitRpm: true,
        maxCsvRows: true,
        maxCsvBytes: true,
        maxBatchPhones: true,
        wallet: true,
        tenantTariff: {
          include: { tariffPlan: true },
        },
        _count: {
          select: { apiKeys: true, webhookEndpoints: true, jobs: true, memberships: true },
        },
      },
    });
    if (!tenant) {
      throw new NotFoundException({
        errorCode: ErrorCodes.NOT_FOUND,
        message: `Tenant ${id} not found`,
      });
    }

    const [apiKeys, webhooks] = await Promise.all([
      this.apiKeys.listByTenant(id, 1, 5),
      this.webhooks.listByTenant(id, 1, 5),
    ]);

    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
      rateLimitRpm: tenant.rateLimitRpm,
      maxCsvRows: tenant.maxCsvRows,
      maxCsvBytes: tenant.maxCsvBytes,
      maxBatchPhones: tenant.maxBatchPhones,
      wallet: tenant.wallet
        ? {
            id: tenant.wallet.id,
            currency: tenant.wallet.currency,
            availableBalance: tenant.wallet.availableBalance.toString(),
            heldBalance: tenant.wallet.heldBalance.toString(),
            updatedAt: tenant.wallet.updatedAt,
          }
        : null,
      tariff: tenant.tenantTariff
        ? {
            tariffPlanId: tenant.tenantTariff.tariffPlanId,
            code: tenant.tenantTariff.tariffPlan.code,
            name: tenant.tenantTariff.tariffPlan.name,
            hlrPrice: tenant.tenantTariff.tariffPlan.hlrPrice.toString(),
            pingPrice: tenant.tenantTariff.tariffPlan.pingPrice.toString(),
            hlrPriceOverride: tenant.tenantTariff.hlrPriceOverride?.toString() ?? null,
            pingPriceOverride: tenant.tenantTariff.pingPriceOverride?.toString() ?? null,
          }
        : null,
      counts: tenant._count,
      apiKeysPreview: apiKeys.items,
      webhooksPreview: webhooks.items,
    };
  }

  async updateTenantStatus(
    id: string,
    status: TenantStatus,
    actorUserId: string,
    meta?: { ip?: string | null; userAgent?: string | null },
  ) {
    const allowed: TenantStatus[] = ['ACTIVE', 'SUSPENDED', 'ARCHIVED'];
    if (!allowed.includes(status)) {
      throw new BadRequestException({
        errorCode: ErrorCodes.VALIDATION_FAILED,
        message: 'Invalid tenant status',
      });
    }
    const existing = await this.tenants.getById(id);
    const updated = await this.prisma.tenant.update({
      where: { id },
      data: { status },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        updatedAt: true,
      },
    });
    await this.audit.write({
      tenantId: id,
      actorType: 'USER',
      actorUserId,
      action: 'admin.tenant.status_change',
      targetType: 'Tenant',
      targetId: id,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
      metadata: { from: existing.status, to: status },
    });
    return updated;
  }

  assignTariff(
    tenantId: string,
    tariffPlanId: string,
    actorUserId: string,
    overrides?: { hlrPriceOverride?: string; pingPriceOverride?: string },
  ) {
    return this.tariffs.assignToTenant(
      {
        tenantId,
        tariffPlanId,
        hlrPriceOverride: overrides?.hlrPriceOverride,
        pingPriceOverride: overrides?.pingPriceOverride,
      },
      actorUserId,
    );
  }

  async listJobs(input: {
    page: number;
    pageSize: number;
    tenantId?: string;
    status?: string;
    checkType?: string;
  }) {
    const skip = (input.page - 1) * input.pageSize;
    const where = {
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.status
        ? {
            status: input.status as
              | 'QUEUED'
              | 'PROCESSING'
              | 'COMPLETED'
              | 'COMPLETED_WITH_ERRORS'
              | 'FAILED'
              | 'CANCELLED',
          }
        : {}),
      ...(input.checkType
        ? { checkType: input.checkType as 'HLR' | 'PING' }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.job.findMany({
        where,
        skip,
        take: input.pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          tenant: { select: { id: true, slug: true, name: true } },
        },
      }),
      this.prisma.job.count({ where }),
    ]);
    return {
      items: rows.map((j) => ({
        id: j.id,
        tenantId: j.tenantId,
        tenant: j.tenant,
        checkType: j.checkType,
        source: j.source,
        status: j.status,
        itemCount: j.itemCount,
        successCount: j.successCount,
        failureCount: j.failureCount,
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
        completedAt: j.completedAt,
      })),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async getJob(id: string) {
    const job = await this.prisma.job.findUnique({
      where: { id },
      include: {
        tenant: { select: { id: true, slug: true, name: true } },
      },
    });
    if (!job) {
      throw new NotFoundException({
        errorCode: ErrorCodes.NOT_FOUND,
        message: `Job ${id} not found`,
      });
    }
    const detail = await this.jobs.getByIdForTenant(job.tenantId, id);
    return { ...detail, tenant: job.tenant };
  }

  listJobItems(jobId: string, page: number, pageSize: number, status?: string) {
    return this.prisma.job.findUnique({ where: { id: jobId } }).then((job) => {
      if (!job) {
        throw new NotFoundException({
          errorCode: ErrorCodes.NOT_FOUND,
          message: `Job ${jobId} not found`,
        });
      }
      return this.jobs.listItemsForTenant({
        tenantId: job.tenantId,
        jobId,
        page,
        pageSize,
        status,
      });
    });
  }

  getWallet(tenantId: string) {
    return this.wallets.getByTenantId(tenantId);
  }

  listLedger(tenantId: string) {
    return this.billing.listLedger(tenantId);
  }

  topup(input: {
    tenantId: string;
    amount: string;
    idempotencyKey: string;
    description?: string;
    createdById: string;
  }) {
    return this.billing.topupIdempotent(input);
  }

  adjust(input: {
    tenantId: string;
    amount: string;
    direction: 'credit' | 'debit';
    idempotencyKey: string;
    description?: string;
    createdById: string;
    allowNegative?: boolean;
  }) {
    return this.billing.adjust(input);
  }

  async monitoring() {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const adapter = this.provider.getAdapterStatus();
    const [providerByStatus, webhookByStatus, recentFailed] = await Promise.all([
      this.prisma.providerRequest.groupBy({
        by: ['status'],
        where: { createdAt: { gte: since24h } },
        _count: { _all: true },
      }),
      this.prisma.webhookDelivery.groupBy({
        by: ['status'],
        where: { createdAt: { gte: since24h } },
        _count: { _all: true },
      }),
      this.provider.listRecentRequests(20),
    ]);

    return {
      provider: adapter,
      providerRequests24h: Object.fromEntries(
        providerByStatus.map((r) => [r.status, r._count._all]),
      ),
      webhookDeliveries24h: Object.fromEntries(
        webhookByStatus.map((r) => [r.status, r._count._all]),
      ),
      recentProviderRequests: recentFailed,
    };
  }

  listTariffs(page: number, pageSize: number) {
    return this.tariffs.list(page, pageSize);
  }
}
