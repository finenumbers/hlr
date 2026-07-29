import type { CheckType, Prisma, PrismaClient } from '@finenumbers/db';

import { BillingError } from './errors.js';
import {
  assertNonNegativeMoney,
  money,
  moneyFromSafeInteger,
  moneyMul,
  moneyToString,
} from './money.js';
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

function pickPrices(
  plan: {
    id: string;
    code: string;
    currency: string;
    hlrPrice: Prisma.Decimal;
    pingPrice: Prisma.Decimal;
    hlrProviderCost: Prisma.Decimal;
    pingProviderCost: Prisma.Decimal;
    isActive: boolean;
  },
  checkType: CheckType,
  overrides?: {
    hlrPriceOverride: Prisma.Decimal | null;
    pingPriceOverride: Prisma.Decimal | null;
  } | null,
): { sellPrice: Prisma.Decimal; providerCost: Prisma.Decimal } {
  if (!plan.isActive) {
    throw new BillingError('INVALID_TARIFF', `Tariff plan ${plan.code} is inactive`, {
      details: { tariffPlanId: plan.id },
    });
  }

  const sellRaw =
    checkType === 'HLR'
      ? (overrides?.hlrPriceOverride ?? plan.hlrPrice)
      : (overrides?.pingPriceOverride ?? plan.pingPrice);
  const providerRaw = checkType === 'HLR' ? plan.hlrProviderCost : plan.pingProviderCost;

  let sellPrice: Prisma.Decimal;
  let providerCost: Prisma.Decimal;
  try {
    sellPrice = assertNonNegativeMoney(sellRaw, 'sellPrice');
    providerCost = assertNonNegativeMoney(providerRaw, 'providerCost');
  } catch (error) {
    throw new BillingError('INVALID_TARIFF', 'Tariff prices must be non-negative decimals', {
      details: { tariffPlanId: plan.id, checkType },
      cause: error,
    });
  }

  if (sellPrice.lte(0)) {
    throw new BillingError('INVALID_TARIFF', `Sell price for ${checkType} must be > 0`, {
      details: { tariffPlanId: plan.id, checkType, sellPrice: moneyToString(sellPrice) },
    });
  }

  return { sellPrice, providerCost };
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
      where: { tenantId },
      include: { tariffPlan: true },
    });

    if (assignment) {
      if (assignment.effectiveTo && assignment.effectiveTo <= now) {
        throw new BillingError(
          'TARIFF_NOT_CONFIGURED',
          `Tenant tariff assignment expired for tenant ${tenantId}`,
          { details: { tenantId, tenantTariffId: assignment.id } },
        );
      }
      if (assignment.effectiveFrom > now) {
        throw new BillingError(
          'TARIFF_NOT_CONFIGURED',
          `Tenant tariff assignment not yet effective for tenant ${tenantId}`,
          { details: { tenantId, tenantTariffId: assignment.id } },
        );
      }

      const prices = pickPrices(assignment.tariffPlan, type, assignment);
      const hasOverride =
        type === 'HLR'
          ? assignment.hlrPriceOverride !== null
          : assignment.pingPriceOverride !== null;

      return {
        tariffPlanId: assignment.tariffPlan.id,
        tariffPlanCode: assignment.tariffPlan.code,
        tenantTariffId: assignment.id,
        currency: assignment.tariffPlan.currency,
        checkType: type,
        sellPrice: prices.sellPrice,
        providerCost: prices.providerCost,
        source: hasOverride ? 'tenant_override' : 'tenant_plan',
      };
    }

    const defaultPlan = await db.tariffPlan.findFirst({
      where: { isDefault: true, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    if (!defaultPlan) {
      throw new BillingError(
        'TARIFF_NOT_CONFIGURED',
        `No tariff configured for tenant ${tenantId} and no default plan`,
        { details: { tenantId, checkType: type } },
      );
    }

    const prices = pickPrices(defaultPlan, type, null);
    this.logger.debug('billing.tariff.default_fallback', {
      tenantId,
      tariffPlanId: defaultPlan.id,
      checkType: type,
    });

    return {
      tariffPlanId: defaultPlan.id,
      tariffPlanCode: defaultPlan.code,
      tenantTariffId: null,
      currency: defaultPlan.currency,
      checkType: type,
      sellPrice: prices.sellPrice,
      providerCost: prices.providerCost,
      source: 'default_plan',
    };
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
    const units = moneyFromSafeInteger(input.unitCount, 'unitCount');
    const estimatedSellTotal = moneyMul(resolved.sellPrice, units);
    const estimatedProviderTotal = moneyMul(resolved.providerCost, units);

    return {
      tenantId: input.tenantId,
      checkType: resolved.checkType,
      unitCount: input.unitCount,
      unitSellPrice: moneyToString(resolved.sellPrice),
      unitProviderCost: moneyToString(resolved.providerCost),
      estimatedSellTotal: moneyToString(estimatedSellTotal),
      estimatedProviderTotal: moneyToString(estimatedProviderTotal),
      currency: resolved.currency,
      tariff: {
        tariffPlanId: resolved.tariffPlanId,
        tariffPlanCode: resolved.tariffPlanCode,
        tenantTariffId: resolved.tenantTariffId,
        currency: resolved.currency,
        checkType: resolved.checkType,
        sellPrice: moneyToString(resolved.sellPrice),
        providerCost: moneyToString(resolved.providerCost),
        source: resolved.source,
      },
    };
  }

  /** Validate plan prices before persist (admin CRUD). */
  static validatePlanPrices(input: {
    hlrPrice: string;
    pingPrice: string;
    hlrProviderCost?: string;
    pingProviderCost?: string;
  }): {
    hlrPrice: Prisma.Decimal;
    pingPrice: Prisma.Decimal;
    hlrProviderCost: Prisma.Decimal;
    pingProviderCost: Prisma.Decimal;
  } {
    try {
      const hlrPrice = assertNonNegativeMoney(input.hlrPrice, 'hlrPrice');
      const pingPrice = assertNonNegativeMoney(input.pingPrice, 'pingPrice');
      const hlrProviderCost = assertNonNegativeMoney(
        input.hlrProviderCost ?? '0',
        'hlrProviderCost',
      );
      const pingProviderCost = assertNonNegativeMoney(
        input.pingProviderCost ?? '0',
        'pingProviderCost',
      );
      if (hlrPrice.lte(0) || pingPrice.lte(0)) {
        throw new BillingError('INVALID_TARIFF', 'hlrPrice and pingPrice must be > 0');
      }
      return { hlrPrice, pingPrice, hlrProviderCost, pingProviderCost };
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
      checkType: resolved.checkType,
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
