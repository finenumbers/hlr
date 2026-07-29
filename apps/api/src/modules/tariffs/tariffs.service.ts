import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TariffResolver } from '@finenumbers/billing';
import { Prisma } from '@finenumbers/db';

import type { PaginatedResult } from '../../common/dto/pagination-query.dto';
import { ErrorCodes } from '../../common/errors/error-codes';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AssignTenantTariffDto } from './dto/assign-tenant-tariff.dto';
import type { CreateTariffPlanDto } from './dto/create-tariff-plan.dto';
import type { TariffPlanResponseDto } from './dto/tariff-plan-response.dto';
import type { UpdateTariffPlanDto } from './dto/update-tariff-plan.dto';

@Injectable()
export class TariffsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(page: number, pageSize: number): Promise<PaginatedResult<TariffPlanResponseDto>> {
    const skip = (page - 1) * pageSize;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.tariffPlan.findMany({
        skip,
        take: pageSize,
        orderBy: [{ checkType: 'asc' }, { createdAt: 'desc' }],
      }),
      this.prisma.tariffPlan.count(),
    ]);

    return {
      items: rows.map(mapTariff),
      page,
      pageSize,
      total,
    };
  }

  async getById(id: string): Promise<TariffPlanResponseDto> {
    const plan = await this.prisma.tariffPlan.findUnique({ where: { id } });
    if (!plan) {
      throw new NotFoundException({
        errorCode: ErrorCodes.NOT_FOUND,
        message: `Tariff plan ${id} not found`,
      });
    }
    return mapTariff(plan);
  }

  async create(dto: CreateTariffPlanDto, actorUserId?: string): Promise<TariffPlanResponseDto> {
    let prices;
    try {
      prices = TariffResolver.validatePlanPrices({
        sellPrice: dto.sellPrice,
        providerCost: dto.providerCost,
      });
    } catch (error) {
      throw new BadRequestException({
        errorCode: ErrorCodes.INVALID_TARIFF,
        message: error instanceof Error ? error.message : 'Invalid tariff prices',
      });
    }

    const plan = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.tariffPlan.updateMany({
          where: { isDefault: true, checkType: dto.checkType },
          data: { isDefault: false },
        });
      }
      return tx.tariffPlan.create({
        data: {
          code: dto.code,
          name: dto.name,
          checkType: dto.checkType,
          currency: dto.currency ?? 'RUB',
          sellPrice: prices.sellPrice,
          providerCost: prices.providerCost,
          isDefault: dto.isDefault ?? false,
          isActive: dto.isActive ?? true,
          description: dto.description ?? null,
        },
      });
    });

    await this.audit.write({
      actorType: 'USER',
      actorUserId: actorUserId ?? null,
      action: 'billing.tariff.create',
      targetType: 'TariffPlan',
      targetId: plan.id,
      metadata: { code: plan.code, checkType: plan.checkType, isDefault: plan.isDefault },
    });

    return mapTariff(plan);
  }

  async update(
    id: string,
    dto: UpdateTariffPlanDto,
    actorUserId?: string,
  ): Promise<TariffPlanResponseDto> {
    const existing = await this.prisma.tariffPlan.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        errorCode: ErrorCodes.NOT_FOUND,
        message: `Tariff plan ${id} not found`,
      });
    }

    const nextPrices = {
      sellPrice: dto.sellPrice ?? existing.sellPrice.toString(),
      providerCost: dto.providerCost ?? existing.providerCost.toString(),
    };

    let prices;
    try {
      prices = TariffResolver.validatePlanPrices(nextPrices);
    } catch (error) {
      throw new BadRequestException({
        errorCode: ErrorCodes.INVALID_TARIFF,
        message: error instanceof Error ? error.message : 'Invalid tariff prices',
      });
    }

    const plan = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault === true) {
        await tx.tariffPlan.updateMany({
          where: { isDefault: true, checkType: existing.checkType, NOT: { id } },
          data: { isDefault: false },
        });
      }
      return tx.tariffPlan.update({
        where: { id },
        data: {
          name: dto.name ?? undefined,
          currency: dto.currency ?? undefined,
          sellPrice: prices.sellPrice,
          providerCost: prices.providerCost,
          isDefault: dto.isDefault ?? undefined,
          isActive: dto.isActive ?? undefined,
          description: dto.description === undefined ? undefined : dto.description,
        },
      });
    });

    await this.audit.write({
      actorType: 'USER',
      actorUserId: actorUserId ?? null,
      action: 'billing.tariff.update',
      targetType: 'TariffPlan',
      targetId: plan.id,
      metadata: {
        code: plan.code,
        checkType: plan.checkType,
        isDefault: plan.isDefault,
        isActive: plan.isActive,
      },
    });

    return mapTariff(plan);
  }

  async assignToTenant(
    dto: AssignTenantTariffDto,
    actorUserId?: string,
  ): Promise<{
    id: string | null;
    tenantId: string;
    checkType: 'HLR' | 'PING';
    tariffPlanId: string | null;
    priceOverride: string | null;
  }> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: dto.tenantId } });
    if (!tenant) {
      throw new NotFoundException({
        errorCode: ErrorCodes.NOT_FOUND,
        message: `Tenant ${dto.tenantId} not found`,
      });
    }

    const planId = dto.tariffPlanId?.trim() ? dto.tariffPlanId.trim() : null;

    if (!planId) {
      const existing = await this.prisma.tenantTariff.findUnique({
        where: {
          tenantId_checkType: { tenantId: dto.tenantId, checkType: dto.checkType },
        },
      });
      if (existing) {
        await this.prisma.tenantTariff.delete({ where: { id: existing.id } });
        await this.audit.write({
          tenantId: dto.tenantId,
          actorType: 'USER',
          actorUserId: actorUserId ?? null,
          action: 'billing.tariff.unassign',
          targetType: 'TenantTariff',
          targetId: existing.id,
          metadata: { checkType: dto.checkType },
        });
      }
      return {
        id: null,
        tenantId: dto.tenantId,
        checkType: dto.checkType,
        tariffPlanId: null,
        priceOverride: null,
      };
    }

    const plan = await this.prisma.tariffPlan.findUnique({ where: { id: planId } });
    if (!plan || !plan.isActive) {
      throw new BadRequestException({
        errorCode: ErrorCodes.INVALID_TARIFF,
        message: 'Tariff plan not found or inactive',
      });
    }
    if (plan.checkType !== dto.checkType) {
      throw new BadRequestException({
        errorCode: ErrorCodes.INVALID_TARIFF,
        message: `Plan ${plan.code} is ${plan.checkType}, cannot assign to ${dto.checkType}`,
        details: { planCheckType: plan.checkType, checkType: dto.checkType },
      });
    }

    const priceOverride =
      dto.priceOverride === undefined ? null : new Prisma.Decimal(dto.priceOverride);

    const row = await this.prisma.tenantTariff.upsert({
      where: {
        tenantId_checkType: { tenantId: dto.tenantId, checkType: dto.checkType },
      },
      create: {
        tenantId: dto.tenantId,
        checkType: dto.checkType,
        tariffPlanId: planId,
        priceOverride,
      },
      update: {
        tariffPlanId: planId,
        priceOverride,
        effectiveFrom: new Date(),
        effectiveTo: null,
      },
    });

    await this.audit.write({
      tenantId: dto.tenantId,
      actorType: 'USER',
      actorUserId: actorUserId ?? null,
      action: 'billing.tariff.assign',
      targetType: 'TenantTariff',
      targetId: row.id,
      metadata: {
        checkType: dto.checkType,
        tariffPlanId: planId,
        priceOverride: dto.priceOverride ?? null,
      },
    });

    return {
      id: row.id,
      tenantId: row.tenantId,
      checkType: row.checkType,
      tariffPlanId: row.tariffPlanId,
      priceOverride: row.priceOverride?.toString() ?? null,
    };
  }
}

function mapTariff(plan: {
  id: string;
  code: string;
  name: string;
  checkType: 'HLR' | 'PING';
  currency: string;
  sellPrice: { toString(): string };
  providerCost: { toString(): string };
  isDefault: boolean;
  isActive: boolean;
  description: string | null;
}): TariffPlanResponseDto {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    checkType: plan.checkType,
    currency: plan.currency,
    sellPrice: plan.sellPrice.toString(),
    providerCost: plan.providerCost.toString(),
    isDefault: plan.isDefault,
    isActive: plan.isActive,
    description: plan.description,
  };
}
