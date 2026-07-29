-- Persist normalized snapshots alongside raw provider I/O for debug / remapping.
ALTER TABLE "provider_requests" ADD COLUMN "normalizedResult" JSONB;
ALTER TABLE "provider_callbacks" ADD COLUMN "normalizedResult" JSONB;
