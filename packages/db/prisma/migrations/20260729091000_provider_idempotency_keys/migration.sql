-- Dedicated columns for adapter-level dedupe (plus partial uniques).
ALTER TABLE "provider_requests" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "provider_callbacks" ADD COLUMN "dedupeKey" TEXT;

CREATE INDEX "provider_requests_providerCode_tenantId_idempotencyKey_idx"
  ON "provider_requests"("providerCode", "tenantId", "idempotencyKey");

CREATE INDEX "provider_callbacks_providerCode_dedupeKey_idx"
  ON "provider_callbacks"("providerCode", "dedupeKey");

-- One active (PENDING|SUCCEEDED) SEND per idempotency key — FAILED may retry.
CREATE UNIQUE INDEX "provider_requests_active_idempotency_uidx"
  ON "provider_requests"("providerCode", "tenantId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL AND "status" IN ('PENDING', 'SUCCEEDED');

-- Exactly one stored callback per fingerprint.
CREATE UNIQUE INDEX "provider_callbacks_dedupe_uidx"
  ON "provider_callbacks"("providerCode", "dedupeKey")
  WHERE "dedupeKey" IS NOT NULL;
