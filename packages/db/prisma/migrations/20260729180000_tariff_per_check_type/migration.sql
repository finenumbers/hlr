-- Split dual-price tariff plans into per-CheckType plans and dual tenant assignments.
-- Billing no longer uses a silent default fallback; assignments are explicit per type.

-- 1) New columns on tariff_plans
ALTER TABLE "tariff_plans" ADD COLUMN "checkType" "CheckType";
ALTER TABLE "tariff_plans" ADD COLUMN "sellPrice" DECIMAL(18,6);
ALTER TABLE "tariff_plans" ADD COLUMN "providerCost" DECIMAL(18,6) NOT NULL DEFAULT 0;

-- Existing rows become HLR plans (keep id/code).
UPDATE "tariff_plans"
SET
  "checkType" = 'HLR',
  "sellPrice" = "hlrPrice",
  "providerCost" = "hlrProviderCost";

-- PING clones (unique codes via -PING suffix).
INSERT INTO "tariff_plans" (
  "id",
  "code",
  "name",
  "currency",
  "hlrPrice",
  "pingPrice",
  "hlrProviderCost",
  "pingProviderCost",
  "checkType",
  "sellPrice",
  "providerCost",
  "isDefault",
  "isActive",
  "description",
  "createdAt",
  "updatedAt"
)
SELECT
  md5(random()::text || clock_timestamp()::text || h."id")::text,
  h."code" || '-PING',
  h."name" || ' (Ping)',
  h."currency",
  h."pingPrice",
  h."pingPrice",
  h."pingProviderCost",
  h."pingProviderCost",
  'PING',
  h."pingPrice",
  h."pingProviderCost",
  false,
  h."isActive",
  h."description",
  NOW(),
  NOW()
FROM "tariff_plans" h
WHERE h."checkType" = 'HLR';

-- Carry catalog default flag to the matching Ping clone (one default per type).
UPDATE "tariff_plans" AS ping
SET "isDefault" = true
FROM "tariff_plans" AS hlr
WHERE hlr."checkType" = 'HLR'
  AND hlr."isDefault" = true
  AND ping."checkType" = 'PING'
  AND ping."code" = hlr."code" || '-PING';

ALTER TABLE "tariff_plans" ALTER COLUMN "checkType" SET NOT NULL;
ALTER TABLE "tariff_plans" ALTER COLUMN "sellPrice" SET NOT NULL;

-- 2) Tenant assignments: per checkType
ALTER TABLE "tenant_tariffs" ADD COLUMN "checkType" "CheckType";
ALTER TABLE "tenant_tariffs" ADD COLUMN "priceOverride" DECIMAL(18,6);

UPDATE "tenant_tariffs"
SET
  "checkType" = 'HLR',
  "priceOverride" = "hlrPriceOverride";

ALTER TABLE "tenant_tariffs" ALTER COLUMN "checkType" SET NOT NULL;

-- Ping assignments from prior dual overrides / dual plans
INSERT INTO "tenant_tariffs" (
  "id",
  "tenantId",
  "tariffPlanId",
  "checkType",
  "priceOverride",
  "hlrPriceOverride",
  "pingPriceOverride",
  "effectiveFrom",
  "effectiveTo",
  "createdAt",
  "updatedAt"
)
SELECT
  md5(random()::text || clock_timestamp()::text || tt."id" || '-ping')::text,
  tt."tenantId",
  ping."id",
  'PING',
  tt."pingPriceOverride",
  NULL,
  NULL,
  tt."effectiveFrom",
  tt."effectiveTo",
  NOW(),
  NOW()
FROM "tenant_tariffs" tt
JOIN "tariff_plans" hlr ON hlr."id" = tt."tariffPlanId" AND hlr."checkType" = 'HLR'
JOIN "tariff_plans" ping ON ping."code" = hlr."code" || '-PING' AND ping."checkType" = 'PING'
WHERE tt."checkType" = 'HLR';

DROP INDEX IF EXISTS "tenant_tariffs_tenantId_key";
CREATE UNIQUE INDEX "tenant_tariffs_tenantId_checkType_key" ON "tenant_tariffs"("tenantId", "checkType");

-- 3) Drop legacy dual-price columns
ALTER TABLE "tariff_plans" DROP COLUMN "hlrPrice";
ALTER TABLE "tariff_plans" DROP COLUMN "pingPrice";
ALTER TABLE "tariff_plans" DROP COLUMN "hlrProviderCost";
ALTER TABLE "tariff_plans" DROP COLUMN "pingProviderCost";

ALTER TABLE "tenant_tariffs" DROP COLUMN "hlrPriceOverride";
ALTER TABLE "tenant_tariffs" DROP COLUMN "pingPriceOverride";

-- Indexes for catalog lookups
DROP INDEX IF EXISTS "tariff_plans_isDefault_isActive_idx";
CREATE INDEX "tariff_plans_checkType_isActive_idx" ON "tariff_plans"("checkType", "isActive");
CREATE INDEX "tariff_plans_checkType_isDefault_isActive_idx" ON "tariff_plans"("checkType", "isDefault", "isActive");
