-- AlterTable
ALTER TABLE "webhook_endpoints" ADD COLUMN "consecutiveFailures" INTEGER NOT NULL DEFAULT 0;
