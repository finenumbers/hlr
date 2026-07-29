-- Best-effort backfill for open jobs/items that predate price snapshots.
-- Uses the tenant's *current* assignment for that checkType (not historical price).
-- Terminal jobs are left NULL; they must not reserve again.

UPDATE "job_items" AS ji
SET
  "unitSellPrice" = COALESCE(tt."priceOverride", tp."sellPrice"),
  "unitProviderCost" = tp."providerCost",
  "tariffPlanId" = tp."id",
  "tariffPlanCode" = tp."code",
  "estimatedCost" = COALESCE(ji."estimatedCost", COALESCE(tt."priceOverride", tp."sellPrice"))
FROM "tenant_tariffs" AS tt
INNER JOIN "tariff_plans" AS tp ON tp."id" = tt."tariffPlanId"
WHERE ji."tenantId" = tt."tenantId"
  AND ji."checkType" = tt."checkType"
  AND ji."unitSellPrice" IS NULL
  AND ji."status" IN ('QUEUED', 'RESERVED', 'SENT', 'PENDING');

UPDATE "jobs" AS j
SET
  "unitSellPrice" = COALESCE(tt."priceOverride", tp."sellPrice"),
  "unitProviderCost" = tp."providerCost",
  "tariffPlanId" = tp."id",
  "tariffPlanCode" = tp."code"
FROM "tenant_tariffs" AS tt
INNER JOIN "tariff_plans" AS tp ON tp."id" = tt."tariffPlanId"
WHERE j."tenantId" = tt."tenantId"
  AND j."checkType" = tt."checkType"
  AND j."unitSellPrice" IS NULL
  AND j."status" IN ('QUEUED', 'PROCESSING');
