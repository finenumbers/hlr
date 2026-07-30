import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { MembershipRole, TenantStatus } from '@finenumbers/db';
import { normalizePhoneE164, JobsValidationError } from '@finenumbers/jobs';
import { isProviderError } from '@finenumbers/provider-core';
import { verifyCallbackSignature } from '@finenumbers/provider-smsc';
import { hash } from 'bcryptjs';

import { AppConfigService } from '../../common/config/app-config.service';
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
import { mapTenantTariffsSummary } from './tenant-tariff-summary';

const BCRYPT_COST = 12;

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
    private readonly config: AppConfigService,
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
          tenantTariffs: {
            select: {
              checkType: true,
              tariffPlanId: true,
              tariffPlan: {
                select: { code: true, name: true, checkType: true, isActive: true },
              },
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
        tariffs: mapTenantTariffsSummary(t.tenantTariffs),
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
        tenantTariffs: {
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
      tariffs: await this.resolveTenantTariffViews(id, tenant.tenantTariffs),
      counts: tenant._count,
      apiKeysPreview: apiKeys.items,
      webhooksPreview: webhooks.items,
    };
  }

  /**
   * Admin tariff slots: `none` | `active` | `invalid` (row exists but not billable).
   * Sell price only when status=active (same resolver as client charge).
   */
  private async resolveTenantTariffViews(
    tenantId: string,
    rows: TariffAssignmentDetail[],
  ) {
    const inspected = await this.billing.inspectProductTariffs(tenantId);
    const mapSlot = (
      status: (typeof inspected)['hlr'],
      row: TariffAssignmentDetail | undefined,
    ) => {
      if (status.status === 'none') {
        return null;
      }
      if (status.status === 'active' && status.quote) {
        return {
          status: 'active' as const,
          tariffPlanId: status.quote.tariffPlanId,
          code: status.quote.tariffPlanCode,
          name: status.quote.tariffPlanName,
          sellPrice: status.quote.unitSellPrice,
          priceOverride: row?.priceOverride?.toString() ?? null,
        };
      }
      return {
        status: 'invalid' as const,
        tariffPlanId: row?.tariffPlanId ?? null,
        code: row?.tariffPlan.code ?? null,
        name: row?.tariffPlan.name ?? null,
        sellPrice: null,
        priceOverride: row?.priceOverride?.toString() ?? null,
        reasonCode: status.reasonCode ?? null,
        reasonMessage: status.reasonMessage ?? null,
      };
    };
    return {
      hlr: mapSlot(
        inspected.hlr,
        rows.find((r) => r.checkType === 'HLR'),
      ),
      ping: mapSlot(
        inspected.ping,
        rows.find((r) => r.checkType === 'PING'),
      ),
    };
  }

  async createTenant(
    input: {
      slug: string;
      name: string;
      rateLimitRpm?: number | null;
      maxCsvRows?: number | null;
      maxCsvBytes?: number | null;
      maxBatchPhones?: number | null;
      owner?: {
        email: string;
        password: string;
        name?: string;
        role?: MembershipRole;
      };
    },
    actorUserId: string,
    meta?: { ip?: string | null; userAgent?: string | null },
  ) {
    const slug = normalizeSlug(input.slug);
    const name = input.name.trim();
    if (!slug || !name) {
      throw new BadRequestException({
        errorCode: ErrorCodes.VALIDATION_FAILED,
        message: 'slug and name are required',
      });
    }

    const existing = await this.prisma.tenant.findUnique({ where: { slug } });
    if (existing) {
      throw new ConflictException({
        errorCode: ErrorCodes.CONFLICT,
        message: `Tenant slug "${slug}" already exists`,
      });
    }

    if (input.owner) {
      const email = normalizeEmail(input.owner.email);
      const existingUser = await this.prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        throw new ConflictException({
          errorCode: ErrorCodes.CONFLICT,
          message: `User email "${email}" already exists`,
        });
      }
      if (!input.owner.password || input.owner.password.length < 8) {
        throw new BadRequestException({
          errorCode: ErrorCodes.VALIDATION_FAILED,
          message: 'Owner password must be at least 8 characters',
        });
      }
    }

    const tenant = await this.prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: {
          slug,
          name,
          status: 'ACTIVE',
          rateLimitRpm: input.rateLimitRpm ?? null,
          maxCsvRows: input.maxCsvRows ?? null,
          maxCsvBytes: input.maxCsvBytes ?? null,
          maxBatchPhones: input.maxBatchPhones ?? null,
        },
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          createdAt: true,
          rateLimitRpm: true,
          maxCsvRows: true,
          maxCsvBytes: true,
          maxBatchPhones: true,
        },
      });

      let owner: {
        id: string;
        email: string;
        name: string | null;
        role: MembershipRole;
      } | null = null;

      if (input.owner) {
        const email = normalizeEmail(input.owner.email);
        const passwordHash = await hash(input.owner.password, BCRYPT_COST);
        const role: MembershipRole = input.owner.role ?? 'OWNER';
        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            name: input.owner.name?.trim() || null,
            isActive: true,
          },
          select: { id: true, email: true, name: true },
        });
        await tx.tenantMembership.create({
          data: {
            tenantId: created.id,
            userId: user.id,
            role,
          },
        });
        owner = { ...user, role };
      }

      return { ...created, owner };
    });

    await this.billing.ensureWallet(tenant.id, 'RUB');

    await this.audit.write({
      tenantId: tenant.id,
      actorType: 'USER',
      actorUserId,
      action: 'admin.tenant.create',
      targetType: 'Tenant',
      targetId: tenant.id,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
      metadata: {
        slug: tenant.slug,
        ownerEmail: tenant.owner?.email ?? null,
        ownerRole: tenant.owner?.role ?? null,
      },
    });

    return tenant;
  }

  async createTenantUser(
    tenantId: string,
    input: {
      email: string;
      password: string;
      name?: string;
      role?: MembershipRole;
    },
    actorUserId: string,
    meta?: { ip?: string | null; userAgent?: string | null },
  ) {
    await this.tenants.getById(tenantId);

    const email = normalizeEmail(input.email);
    if (!input.password || input.password.length < 8) {
      throw new BadRequestException({
        errorCode: ErrorCodes.VALIDATION_FAILED,
        message: 'Password must be at least 8 characters',
      });
    }
    const role: MembershipRole = input.role ?? 'MEMBER';
    if (!['OWNER', 'ADMIN', 'MEMBER'].includes(role)) {
      throw new BadRequestException({
        errorCode: ErrorCodes.VALIDATION_FAILED,
        message: 'Invalid membership role',
      });
    }

    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      const existingMembership = await this.prisma.tenantMembership.findUnique({
        where: {
          tenantId_userId: { tenantId, userId: existingUser.id },
        },
      });
      if (existingMembership) {
        throw new ConflictException({
          errorCode: ErrorCodes.CONFLICT,
          message: 'User is already a member of this tenant',
        });
      }
      throw new ConflictException({
        errorCode: ErrorCodes.CONFLICT,
        message: `User email "${email}" already exists`,
      });
    }

    const passwordHash = await hash(input.password, BCRYPT_COST);
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          name: input.name?.trim() || null,
          isActive: true,
        },
        select: { id: true, email: true, name: true, isActive: true, createdAt: true },
      });
      const membership = await tx.tenantMembership.create({
        data: { tenantId, userId: user.id, role },
        select: { id: true, role: true, createdAt: true },
      });
      return { user, membership };
    });

    await this.audit.write({
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: 'admin.user.create',
      targetType: 'User',
      targetId: result.user.id,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
      metadata: { email, role, membershipId: result.membership.id },
    });

    return result;
  }

  async listTenantMembers(tenantId: string) {
    await this.tenants.getById(tenantId);
    const items = await this.prisma.tenantMembership.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            isActive: true,
            lastLoginAt: true,
            createdAt: true,
          },
        },
      },
    });
    return { items };
  }

  async updateTenantLimits(
    id: string,
    input: {
      rateLimitRpm?: number | null;
      maxCsvRows?: number | null;
      maxCsvBytes?: number | null;
      maxBatchPhones?: number | null;
    },
    actorUserId: string,
    meta?: { ip?: string | null; userAgent?: string | null },
  ) {
    await this.tenants.getById(id);
    const updated = await this.prisma.tenant.update({
      where: { id },
      data: {
        ...(input.rateLimitRpm !== undefined ? { rateLimitRpm: input.rateLimitRpm } : {}),
        ...(input.maxCsvRows !== undefined ? { maxCsvRows: input.maxCsvRows } : {}),
        ...(input.maxCsvBytes !== undefined ? { maxCsvBytes: input.maxCsvBytes } : {}),
        ...(input.maxBatchPhones !== undefined ? { maxBatchPhones: input.maxBatchPhones } : {}),
      },
      select: {
        id: true,
        slug: true,
        rateLimitRpm: true,
        maxCsvRows: true,
        maxCsvBytes: true,
        maxBatchPhones: true,
        updatedAt: true,
      },
    });
    await this.audit.write({
      tenantId: id,
      actorType: 'USER',
      actorUserId,
      action: 'admin.tenant.limits_update',
      targetType: 'Tenant',
      targetId: id,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
      metadata: { ...input },
    });
    return updated;
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
    input: {
      checkType: 'HLR' | 'PING';
      tariffPlanId?: string | null;
      priceOverride?: string;
    },
    actorUserId: string,
  ) {
    return this.tariffs.assignToTenant(
      {
        tenantId,
        checkType: input.checkType,
        tariffPlanId: input.tariffPlanId,
        priceOverride: input.priceOverride,
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

  /** Force finalize / heal a stuck PROCESSING job (SUPERADMIN). */
  async finalizeJob(jobId: string, actorUserId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException({
        errorCode: ErrorCodes.NOT_FOUND,
        message: `Job ${jobId} not found`,
      });
    }

    // Heal DB synchronously first — Redis/BullMQ must not block admin recovery.
    const finalized = await this.jobs.getLifecycle().processFinalizeJob({
      jobId: job.id,
      tenantId: job.tenantId,
      reason: 'admin-heal',
    });

    try {
      await this.jobs.getProcessor().enqueueFinalizeJob({
        jobId: job.id,
        tenantId: job.tenantId,
        reason: 'admin-heal',
      });
    } catch {
      // Worker may still pick it up later via reconciliation; DB heal already ran.
    }

    try {
      await this.audit.write({
        tenantId: job.tenantId,
        actorType: 'USER',
        actorUserId,
        action: 'admin.job.finalize',
        targetType: 'Job',
        targetId: job.id,
        metadata: {
          beforeStatus: job.status,
          afterStatus: finalized?.status ?? job.status,
        },
      });
    } catch {
      // Audit must not undo a successful heal.
    }

    return this.getJob(jobId);
  }

  getWallet(tenantId: string) {
    return this.wallets.getByTenantId(tenantId);
  }

  listLedger(tenantId: string) {
    return this.billing.listLedger(tenantId);
  }

  /**
   * Platform-wide wallet journal (newest first), optional filter by tenant.
   */
  async listPlatformLedger(page: number, pageSize: number, tenantId?: string) {
    const where = tenantId?.trim() ? { tenantId: tenantId.trim() } : {};
    const [total, rows] = await Promise.all([
      this.prisma.walletTransaction.count({ where }),
      this.prisma.walletTransaction.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          tenantId: true,
          type: true,
          amount: true,
          currency: true,
          balanceAfterAvailable: true,
          balanceAfterHeld: true,
          jobItemId: true,
          description: true,
          createdAt: true,
          tenant: {
            select: { id: true, name: true, slug: true },
          },
        },
      }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        tenantName: row.tenant.name,
        tenantSlug: row.tenant.slug,
        type: row.type,
        amount: row.amount.toString(),
        currency: row.currency,
        balanceAfterAvailable:
          row.balanceAfterAvailable === null ? null : row.balanceAfterAvailable.toString(),
        balanceAfterHeld:
          row.balanceAfterHeld === null ? null : row.balanceAfterHeld.toString(),
        jobItemId: row.jobItemId,
        description: row.description,
        createdAt: row.createdAt,
      })),
      page,
      pageSize,
      total,
    };
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

  createTariff(
    dto: Parameters<TariffsService['create']>[0],
    actorUserId: string,
  ) {
    return this.tariffs.create(dto, actorUserId);
  }

  updateTariff(
    id: string,
    dto: Parameters<TariffsService['update']>[1],
    actorUserId: string,
  ) {
    return this.tariffs.update(id, dto, actorUserId);
  }

  /**
   * Live SMSC cost probe (provider sell-to-us price), not client tariff.
   * Does not return raw provider payload to the admin UI.
   */
  async estimateSmscCost(input: {
    checkType: 'HLR' | 'PING';
    phone: string;
    correlationId?: string;
  }) {
    let phoneE164: string;
    try {
      phoneE164 = normalizePhoneE164(input.phone);
    } catch (error) {
      if (error instanceof JobsValidationError) {
        throw new BadRequestException({
          errorCode: ErrorCodes.VALIDATION_FAILED,
          message: error.message,
          details: error.details,
        });
      }
      throw error;
    }

    try {
      const estimate =
        input.checkType === 'HLR'
          ? await this.provider.estimateHlrCost({
              phoneE164,
              correlationId: input.correlationId,
            })
          : await this.provider.estimatePingCost({
              phoneE164,
              correlationId: input.correlationId,
            });

      return {
        providerCode: estimate.providerCode,
        checkType: estimate.checkType,
        phoneE164: estimate.phoneE164,
        cost: estimate.cost,
        currency: estimate.currency,
        parts: estimate.parts,
      };
    } catch (error) {
      throw mapProviderHttpError(error);
    }
  }

  async getSmscBalance(correlationId?: string) {
    try {
      const balance = await this.provider.getBalance(correlationId);
      return {
        providerCode: balance.providerCode,
        balance: balance.balance,
        currency: balance.currency,
      };
    } catch (error) {
      throw mapProviderHttpError(error);
    }
  }

  /**
   * No-charge SMSC connectivity check:
   * - outbound: live getBalance (auth + network to SMSC)
   * - inbound: local callback signature round-trip with SMSC_CALLBACK_SECRET
   * Never calls submitHlr / submitPing.
   */
  async testSmscConnectivity(correlationId?: string) {
    const credentialsConfigured = this.config.smscConfigured;
    const callbackSecretConfigured = this.config.smscCallbackSecretConfigured;
    const publicCallbackUrl = `${this.config.raw.PUBLIC_API_URL.replace(/\/$/, '')}/internal/smsc/callback`;

    const outbound = await this.probeSmscOutbound(correlationId);
    const inbound = this.probeSmscInboundCallback();

    const ok =
      credentialsConfigured &&
      outbound.ok &&
      callbackSecretConfigured &&
      inbound.ok;

    return {
      ok,
      charged: false as const,
      credentialsConfigured,
      callbackSecretConfigured,
      publicCallbackUrl,
      outbound,
      inbound,
    };
  }

  private async probeSmscOutbound(correlationId?: string): Promise<{
    ok: boolean;
    latencyMs: number | null;
    balance: string | null;
    currency: string | null;
    error: string | null;
  }> {
    if (!this.config.smscConfigured) {
      return {
        ok: false,
        latencyMs: null,
        balance: null,
        currency: null,
        error: 'SMSC credentials are not configured (SMSC_LOGIN/PASSWORD or SMSC_API_KEY)',
      };
    }

    const started = Date.now();
    try {
      const balance = await this.provider.getBalance(correlationId);
      return {
        ok: true,
        latencyMs: Date.now() - started,
        balance: balance.balance,
        currency: balance.currency,
        error: null,
      };
    } catch (error) {
      const message =
        error instanceof ServiceUnavailableException
          ? String(
              (error.getResponse() as { message?: string })?.message ??
                error.message,
            )
          : isProviderError(error)
            ? error.message
            : error instanceof Error
              ? error.message
              : 'SMSC outbound probe failed';
      return {
        ok: false,
        latencyMs: Date.now() - started,
        balance: null,
        currency: null,
        error: message,
      };
    }
  }

  private probeSmscInboundCallback(): {
    ok: boolean;
    signatureVerifyOk: boolean;
    rejectInvalidOk: boolean;
    error: string | null;
  } {
    if (!this.config.smscCallbackSecretConfigured) {
      return {
        ok: false,
        signatureVerifyOk: false,
        rejectInvalidOk: false,
        error: 'SMSC_CALLBACK_SECRET is empty — inbound signature verify is disabled',
      };
    }

    const secret = this.config.smscCallbackSecret;
    const payload = {
      id: 'fn-self-test',
      phone: '79991234567',
      status: '1',
    };
    const base = `${payload.id}:${payload.phone}:${payload.status}:${secret}`;
    const md5 = createHash('md5').update(base).digest('hex');

    const valid = verifyCallbackSignature({
      payload: { ...payload, md5 },
      secret,
    });
    const invalid = verifyCallbackSignature({
      payload: { ...payload, md5: 'deadbeefdeadbeefdeadbeefdeadbeef' },
      secret,
    });

    const signatureVerifyOk = valid === true;
    const rejectInvalidOk = invalid === false;
    const ok = signatureVerifyOk && rejectInvalidOk;

    return {
      ok,
      signatureVerifyOk,
      rejectInvalidOk,
      error: ok
        ? null
        : 'Callback signature verification failed self-test',
    };
  }
}

function mapProviderHttpError(error: unknown): never {
  if (error instanceof ServiceUnavailableException) {
    throw error;
  }
  if (isProviderError(error)) {
    if (error.kind === 'auth') {
      throw new ServiceUnavailableException({
        errorCode: ErrorCodes.SERVICE_UNAVAILABLE,
        message: error.message,
      });
    }
    if (error.kind === 'validation') {
      throw new BadRequestException({
        errorCode: ErrorCodes.VALIDATION_FAILED,
        message: error.message,
      });
    }
    if (error.kind === 'rate_limit') {
      throw new BadRequestException({
        errorCode: ErrorCodes.RATE_LIMITED,
        message: error.message,
      });
    }
    throw new BadRequestException({
      errorCode: ErrorCodes.VALIDATION_FAILED,
      message: error.message || 'SMSC provider request failed',
      details: {
        kind: error.kind,
        providerErrorCode: error.providerErrorCode,
      },
    });
  }
  throw error;
}

function normalizeSlug(slug: string): string {
  return slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

type TariffAssignmentSummary = {
  checkType: 'HLR' | 'PING';
  tariffPlanId: string;
  tariffPlan: {
    code: string;
    name: string;
    checkType: 'HLR' | 'PING';
    isActive: boolean;
  };
};

type TariffAssignmentDetail = TariffAssignmentSummary & {
  priceOverride: { toString(): string } | null;
  tariffPlan: {
    code: string;
    name: string;
    checkType: 'HLR' | 'PING';
    sellPrice: { toString(): string };
    isActive: boolean;
  };
};

