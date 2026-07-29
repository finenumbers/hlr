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
        orderBy: { createdAt: 'desc' },
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
      prices = TariffResolver.validatePlanPrices(dto);
    } catch (error) {
      throw new BadRequestException({
        errorCode: ErrorCodes.INVALID_TARIFF,
        message: error instanceof Error ? error.message : 'Invalid tariff prices',
      });
    }

    const plan = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.tariffPlan.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.tariffPlan.create({
        data: {
          code: dto.code,
          name: dto.name,
          currency: dto.currency ?? 'RUB',
          hlrPrice: prices.hlrPrice,
          pingPrice: prices.pingPrice,
          hlrProviderCost: prices.hlrProviderCost,
          pingProviderCost: prices.pingProviderCost,
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
      metadata: { code: plan.code, isDefault: plan.isDefault },
    });

    return mapTariff(plan);
  }

  async assignToTenant(
    dto: AssignTenantTariffDto,
    actorUserId?: string,
  ): Promise<{
    id: string;
    tenantId: string;
    tariffPlanId: string;
    hlrPriceOverride: string | null;
    pingPriceOverride: string | null;
  }> {
    const plan = await this.prisma.tariffPlan.findUnique({ where: { id: dto.tariffPlanId } });
    if (!plan || !plan.isActive) {
      throw new BadRequestException({
        errorCode: ErrorCodes.INVALID_TARIFF,
        message: 'Tariff plan not found or inactive',
      });
    }

    const tenant = await this.prisma.tenant.findUnique({ where: { id: dto.tenantId } });
    if (!tenant) {
      throw new NotFoundException({
        errorCode: ErrorCodes.NOT_FOUND,
        message: `Tenant ${dto.tenantId} not found`,
      });
    }

    const hlrOverride =
      dto.hlrPriceOverride === undefined
        ? null
        : new Prisma.Decimal(dto.hlrPriceOverride);
    const pingOverride =
      dto.pingPriceOverride === undefined
        ? null
        : new Prisma.Decimal(dto.pingPriceOverride);

    const row = await this.prisma.tenantTariff.upsert({
      where: { tenantId: dto.tenantId },
      create: {
        tenantId: dto.tenantId,
        tariffPlanId: dto.tariffPlanId,
        hlrPriceOverride: hlrOverride,
        pingPriceOverride: pingOverride,
      },
      update: {
        tariffPlanId: dto.tariffPlanId,
        hlrPriceOverride: hlrOverride,
        pingPriceOverride: pingOverride,
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
        tariffPlanId: dto.tariffPlanId,
        hlrPriceOverride: dto.hlrPriceOverride ?? null,
        pingPriceOverride: dto.pingPriceOverride ?? null,
      },
    });

    return {
      id: row.id,
      tenantId: row.tenantId,
      tariffPlanId: row.tariffPlanId,
      hlrPriceOverride: row.hlrPriceOverride?.toString() ?? null,
      pingPriceOverride: row.pingPriceOverride?.toString() ?? null,
    };
  }
}

function mapTariff(plan: {
  id: string;
  code: string;
  name: string;
  currency: string;
  hlrPrice: { toString(): string };
  pingPrice: { toString(): string };
  hlrProviderCost: { toString(): string };
  pingProviderCost: { toString(): string };
  isDefault: boolean;
  isActive: boolean;
  description: string | null;
}): TariffPlanResponseDto {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    currency: plan.currency,
    hlrPrice: plan.hlrPrice.toString(),
    pingPrice: plan.pingPrice.toString(),
    hlrProviderCost: plan.hlrProviderCost.toString(),
    pingProviderCost: plan.pingProviderCost.toString(),
    isDefault: plan.isDefault,
    isActive: plan.isActive,
    description: plan.description,
  };
}
