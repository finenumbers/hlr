import {
  moneyFromSafeInteger,
  moneyMul,
  moneyToString,
} from './money.js';
import type { BillingCheckType, CostEstimate, ResolvedTariff } from './types.js';

/**
 * Frozen unit prices for a job accept (shared by API jobs package + billing reserve).
 * Always produced from {@link ResolvedTariff} — never from a sibling checkType.
 */
export type PriceSnapshotDto = {
  checkType: 'HLR' | 'PING';
  unitSellPrice: string;
  unitProviderCost: string;
  tariffPlanId: string;
  tariffPlanCode: string;
  tariffPlanName: string;
  currency: string;
  source: ResolvedTariff['source'];
  tenantTariffId: string | null;
};

export function asHlrOrPing(checkType: BillingCheckType): 'HLR' | 'PING' {
  if (checkType === 'HLR' || checkType === 'PING') {
    return checkType;
  }
  throw new Error(`Unsupported checkType: ${String(checkType)}`);
}

/** Build a job-accept snapshot from a resolved tariff (single checkType). */
export function priceSnapshotFromResolved(resolved: ResolvedTariff): PriceSnapshotDto {
  return {
    checkType: asHlrOrPing(resolved.checkType),
    unitSellPrice: moneyToString(resolved.sellPrice),
    unitProviderCost: moneyToString(resolved.providerCost),
    tariffPlanId: resolved.tariffPlanId,
    tariffPlanCode: resolved.tariffPlanCode,
    tariffPlanName: resolved.tariffPlanName,
    currency: resolved.currency,
    source: resolved.source,
    tenantTariffId: resolved.tenantTariffId,
  };
}

/** Shape accepted by `@finenumbers/jobs` CreateJobInput.priceSnapshot. */
export function toJobPriceSnapshot(resolved: ResolvedTariff): {
  unitSellPrice: string;
  unitProviderCost: string;
  tariffPlanId: string;
  tariffPlanCode: string;
  currency: string;
} {
  const snap = priceSnapshotFromResolved(resolved);
  return {
    unitSellPrice: snap.unitSellPrice,
    unitProviderCost: snap.unitProviderCost,
    tariffPlanId: snap.tariffPlanId,
    tariffPlanCode: snap.tariffPlanCode,
    currency: snap.currency,
  };
}

/** Snapshot from an estimate / assertCanAfford result (already typed strings). */
export function jobPriceSnapshotFromEstimate(estimate: CostEstimate): {
  unitSellPrice: string;
  unitProviderCost: string;
  tariffPlanId: string;
  tariffPlanCode: string;
  currency: string;
} {
  return {
    unitSellPrice: estimate.unitSellPrice,
    unitProviderCost: estimate.unitProviderCost,
    tariffPlanId: estimate.tariff.tariffPlanId,
    tariffPlanCode: estimate.tariff.tariffPlanCode,
    currency: estimate.currency,
  };
}

export function costEstimateFromResolved(
  tenantId: string,
  resolved: ResolvedTariff,
  unitCount: number,
): CostEstimate {
  const units = moneyFromSafeInteger(unitCount, 'unitCount');
  const estimatedSellTotal = moneyMul(resolved.sellPrice, units);
  const estimatedProviderTotal = moneyMul(resolved.providerCost, units);
  const snap = priceSnapshotFromResolved(resolved);

  return {
    tenantId,
    checkType: snap.checkType,
    unitCount,
    unitSellPrice: snap.unitSellPrice,
    unitProviderCost: snap.unitProviderCost,
    estimatedSellTotal: moneyToString(estimatedSellTotal),
    estimatedProviderTotal: moneyToString(estimatedProviderTotal),
    currency: snap.currency,
    tariff: {
      tariffPlanId: snap.tariffPlanId,
      tariffPlanCode: snap.tariffPlanCode,
      tenantTariffId: snap.tenantTariffId,
      currency: snap.currency,
      checkType: snap.checkType,
      sellPrice: snap.unitSellPrice,
      providerCost: snap.unitProviderCost,
      source: snap.source,
    },
  };
}
