-- Intended settle action for terminal job items (Policy B heal path).
CREATE TYPE "JobItemBillingAction" AS ENUM ('CAPTURE', 'RELEASE');

ALTER TABLE "job_items" ADD COLUMN "billingAction" "JobItemBillingAction";

-- Speeds reconcile of stale RESERVED / PENDING items by updatedAt.
CREATE INDEX "job_items_status_updatedAt_idx" ON "job_items"("status", "updatedAt");

-- Prevent cross-item SMSC id collisions (callback mis-route).
CREATE UNIQUE INDEX "job_items_providerCode_providerMessageId_unique"
ON "job_items" ("providerCode", "providerMessageId")
WHERE "providerMessageId" IS NOT NULL;
