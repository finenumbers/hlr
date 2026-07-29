/**
 * Client-facing projections for cabinet API — never expose provider cost /
 * internal tariff internals that belong on admin or ledger internals only.
 */

const PROVIDER_METADATA_KEYS = new Set([
  'providerCost',
  'unitProviderCost',
  'estimatedProviderTotal',
  'tenantTariffId',
  'priceSource',
  'source',
]);

export type CabinetSellEstimate = {
  tenantId: string;
  checkType: string;
  unitCount: number;
  unitSellPrice: string;
  estimatedSellTotal: string;
  currency: string;
  tariff: {
    tariffPlanId: string;
    tariffPlanCode: string;
    currency: string;
    checkType: string;
    sellPrice: string;
  };
};

export function toCabinetSellEstimate(estimate: {
  tenantId: string;
  checkType: string;
  unitCount: number;
  unitSellPrice: string;
  unitProviderCost?: string;
  estimatedSellTotal: string;
  estimatedProviderTotal?: string;
  currency: string;
  tariff: {
    tariffPlanId: string;
    tariffPlanCode: string;
    tenantTariffId?: string | null;
    currency: string;
    checkType: string;
    sellPrice: string;
    providerCost?: string;
    source?: string;
  };
}): CabinetSellEstimate {
  return {
    tenantId: estimate.tenantId,
    checkType: estimate.checkType,
    unitCount: estimate.unitCount,
    unitSellPrice: estimate.unitSellPrice,
    estimatedSellTotal: estimate.estimatedSellTotal,
    currency: estimate.currency,
    tariff: {
      tariffPlanId: estimate.tariff.tariffPlanId,
      tariffPlanCode: estimate.tariff.tariffPlanCode,
      currency: estimate.tariff.currency,
      checkType: estimate.tariff.checkType,
      sellPrice: estimate.tariff.sellPrice,
    },
  };
}

export function toCabinetJobView(job: {
  id: string;
  checkType: string;
  source?: string;
  status: string;
  itemCount: number;
  successCount: number;
  failureCount: number;
  estimatedCost: string | null | undefined;
  actualCost: string | null | undefined;
  currency: string;
  createdAt: Date;
  unitSellPrice?: string | null;
  unitProviderCost?: string | null;
  tariffPlanId?: string | null;
  tariffPlanCode?: string | null;
}) {
  return {
    id: job.id,
    checkType: job.checkType,
    source: job.source,
    status: job.status,
    itemCount: job.itemCount,
    successCount: job.successCount,
    failureCount: job.failureCount,
    estimatedCost:
      job.estimatedCost === null || job.estimatedCost === undefined
        ? null
        : String(job.estimatedCost),
    actualCost:
      job.actualCost === null || job.actualCost === undefined
        ? null
        : String(job.actualCost),
    currency: job.currency,
    createdAt: job.createdAt,
    // Sell snapshot only — never unitProviderCost / internal plan wiring.
    unitSellPrice: job.unitSellPrice ?? null,
  };
}

export function redactLedgerMetadataForClient(
  metadata: unknown,
): Record<string, unknown> | null {
  if (metadata == null) {
    return null;
  }
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (PROVIDER_METADATA_KEYS.has(key)) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function toCabinetLedgerEntry(entry: {
  id: string;
  walletId: string;
  tenantId: string;
  type: string;
  amount: string;
  currency: string;
  balanceAfterAvailable: string | null;
  balanceAfterHeld: string | null;
  relatedHoldId: string | null;
  jobItemId: string | null;
  idempotencyKey: string | null;
  description: string | null;
  metadata: unknown;
  createdById: string | null;
  createdAt: Date;
}) {
  return {
    id: entry.id,
    walletId: entry.walletId,
    tenantId: entry.tenantId,
    type: entry.type,
    amount: entry.amount,
    currency: entry.currency,
    balanceAfterAvailable: entry.balanceAfterAvailable,
    balanceAfterHeld: entry.balanceAfterHeld,
    relatedHoldId: entry.relatedHoldId,
    jobItemId: entry.jobItemId,
    idempotencyKey: entry.idempotencyKey,
    description: entry.description,
    metadata: redactLedgerMetadataForClient(entry.metadata),
    createdById: entry.createdById,
    createdAt: entry.createdAt,
  };
}
