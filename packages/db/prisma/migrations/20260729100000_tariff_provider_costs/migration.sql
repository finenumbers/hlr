-- AlterTable
ALTER TABLE "tariff_plans" ADD COLUMN "hlrProviderCost" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "tariff_plans" ADD COLUMN "pingProviderCost" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "tariff_plans" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "tariff_plans_isDefault_isActive_idx" ON "tariff_plans"("isDefault", "isActive");
