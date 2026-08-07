-- CreateEnum
CREATE TYPE "CsvPreviewStatus" AS ENUM ('READY', 'INVALID', 'CONSUMING', 'CONSUMED', 'EXPIRED');

-- CreateTable
CREATE TABLE "csv_previews" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "checkType" "CheckType" NOT NULL,
    "status" "CsvPreviewStatus" NOT NULL DEFAULT 'READY',
    "originalFilename" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "validCount" INTEGER NOT NULL DEFAULT 0,
    "invalidCount" INTEGER NOT NULL DEFAULT 0,
    "deduplicatedCount" INTEGER NOT NULL DEFAULT 0,
    "phonesJson" JSONB,
    "invalidJson" JSONB,
    "previewUnitSellPrice" DECIMAL(18,6),
    "previewCurrency" CHAR(3) NOT NULL DEFAULT 'RUB',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "csv_previews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "csv_previews_tenantId_status_idx" ON "csv_previews"("tenantId", "status");

-- CreateIndex
CREATE INDEX "csv_previews_expiresAt_idx" ON "csv_previews"("expiresAt");

-- AddForeignKey
ALTER TABLE "csv_previews" ADD CONSTRAINT "csv_previews_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "csv_previews" ADD CONSTRAINT "csv_previews_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
