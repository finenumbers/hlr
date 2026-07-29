import type { CheckType, Prisma, PrismaClient } from '@finenumbers/db';

import { BillingError, isBillingError } from './errors.js';
import {
  assertNonNegativeMoney,
  money,
  moneyToString,
} from './money.js';
import { costEstimateFromResolved } from './price-quote.js';
import type { BillingCheckType, BillingLogger, CostEstimate, ResolvedTariff } from './types.js';

type Db = PrismaClient | Prisma.TransactionClient;

const silentLogger: BillingLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function asCheckType(checkType: BillingCheckType): CheckType {
  if (checkType === 'HLR' || checkType === 'PING') {
    return checkType;
  }
  throw new BillingError('VALIDATION_FAILED', `Unsupported checkType: ${String(checkType)}`, {
    details: { checkType },
  });
}

export class TariffResolver {
  private readonly logger: BillingLogger;

  constructor(
    private readonly prisma: PrismaClient,
    logger?: BillingLogger,
  ) {
    this.logger = logger ?? silentLogger;
  }

  async resolveForTenant(
    tenantId: string,
    checkType: BillingCheckType,
    db: Db = this.prisma,
  ): Promise<ResolvedTariff> {
    const type = asCheckType(checkType);
    const now = new Date();

    const assignment = await db.tenantTariff.findUnique({
      where: { tenantId_checkType: { tenantId, checkType: type } },
      include: { tariffPlan: true },
    });

    if (!assignment) {
      throw new BillingError(
        'TARIFF_NOT_CONFIGURED',
        `No ${type} tariff assigned for tenant ${tenantId}`,
        { details: { tenantId, checkType: type } },
      );
    }

    if (assignment.effectiveTo && assignment.effectiveTo <= now) {
      throw new BillingError(
        'TARIFF_NOT_CONFIGURED',
        `Tenant ${type} tariff assignment expired for tenant ${tenantId}`,
        { details: { tenantId, tenantTariffId: assignment.id, checkType: type } },
      );
    }
    if (assignment.effectiveFrom > now) {
      throw new BillingError(
        'TARIFF_NOT_CONFIGURED',
        `Tenant ${type} tariff assignment not yet effective for tenant ${tenantId}`,
        { details: { tenantId, tenantTariffId: assignment.id, checkType: type } },
      );
    }

    const plan = assignment.tariffPlan;
    if (plan.checkType !== type) {
      throw new BillingError(
        'INVALID_TARIFF',
        `Assigned plan ${plan.code} is ${plan.checkType}, expected ${type}`,
        { details: { tenantId, tariffPlanId: plan.id, checkType: type } },
      );
    }
    if (!plan.isActive) {
      throw new BillingError('INVALID_TARIFF', `Tariff plan ${plan.code} is inactive`, {
        details: { tariffPlanId: plan.id, checkType: type },
      });
    }

    let sellPrice: Prisma.Decimal;
    let providerCost: Prisma.Decimal;
    try {
      sellPrice = assertNonNegativeMoney(
        assignment.priceOverride ?? plan.sellPrice,
        'sellPrice',
      );
      providerCost = assertNonNegativeMoney(plan.providerCost, 'providerCost');
    } catch (error) {
      throw new BillingError('INVALID_TARIFF', 'Tariff prices must be non-negative decimals', {
        details: { tariffPlanId: plan.id, checkType: type },
        cause: error,
      });
    }

    if (sellPrice.lte(0)) {
      throw new BillingError('INVALID_TARIFF', `Sell price for ${type} must be > 0`, {
        details: { tariffPlanId: plan.id, checkType: type, sellPrice: moneyToString(sellPrice) },
      });
    }

    this.logger.debug('billing.tariff.resolved', {
      tenantId,
      tariffPlanId: plan.id,
      checkType: type,
      source: assignment.priceOverride !== null ? 'tenant_override' : 'tenant_plan',
    });

    return {
      tariffPlanId: plan.id,
      tariffPlanCode: plan.code,
      tariffPlanName: plan.name,
      tenantTariffId: assignment.id,
      currency: plan.currency,
      checkType: type,
      sellPrice,
      providerCost,
      source: assignment.priceOverride !== null ? 'tenant_override' : 'tenant_plan',
    };
  }

  /**
   * Soft resolve for display: null when product is not billable
   * (missing / expired / inactive / invalid assignment).
   */
  async tryResolveForTenant(
    tenantId: string,
    checkType: BillingCheckType,
    db: Db = this.prisma,
  ): Promise<ResolvedTariff | null> {
    try {
      return await this.resolveForTenant(tenantId, checkType, db);
    } catch (error) {
      if (
        isBillingError(error) &&
        (error.code === 'TARIFF_NOT_CONFIGURED' || error.code === 'INVALID_TARIFF')
      ) {
        return null;
      }
      throw error;
    }
  }

  async estimate(input: {
    tenantId: string;
    checkType: BillingCheckType;
    unitCount: number;
  }): Promise<CostEstimate> {
    if (!Number.isInteger(input.unitCount) || input.unitCount < 1) {
      throw new BillingError('VALIDATION_FAILED', 'unitCount must be a positive integer', {
        details: { unitCount: input.unitCount },
      });
    }

    const resolved = await this.resolveForTenant(input.tenantId, input.checkType);
    return costEstimateFromResolved(input.tenantId, resolved, input.unitCount);
  }

  /** Validate plan prices before persist (admin CRUD). */
  static validatePlanPrices(input: {
    sellPrice: string;
    providerCost?: string;
  }): {
    sellPrice: Prisma.Decimal;
    providerCost: Prisma.Decimal;
  } {
    try {
      const sellPrice = assertNonNegativeMoney(input.sellPrice, 'sellPrice');
      const providerCost = assertNonNegativeMoney(input.providerCost ?? '0', 'providerCost');
      if (sellPrice.lte(0)) {
        throw new BillingError('INVALID_TARIFF', 'sellPrice must be > 0');
      }
      return { sellPrice, providerCost };
    } catch (error) {
      if (error instanceof BillingError) {
        throw error;
      }
      throw new BillingError('INVALID_TARIFF', 'Invalid tariff price decimals', {
        cause: error,
      });
    }
  }

  static toTariffView(resolved: ResolvedTariff): CostEstimate['tariff'] {
    return {
      tariffPlanId: resolved.tariffPlanId,
      tariffPlanCode: resolved.tariffPlanCode,
      tenantTariffId: resolved.tenantTariffId,
      currency: resolved.currency,
      checkType: resolved.checkType === 'PING' ? 'PING' : 'HLR',
      sellPrice: moneyToString(resolved.sellPrice),
      providerCost: moneyToString(resolved.providerCost),
      source: resolved.source,
    };
  }

  /** Re-export money helper for callers that only have resolver. */
  static money(value: string | Prisma.Decimal): Prisma.Decimal {
    return money(value);
  }
}
