-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPERADMIN', 'SUPPORT');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('CREDIT', 'DEBIT', 'HOLD', 'RELEASE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CheckType" AS ENUM ('HLR', 'PING');

-- CreateEnum
CREATE TYPE "JobSource" AS ENUM ('SINGLE', 'BULK', 'API');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobItemStatus" AS ENUM ('QUEUED', 'RESERVED', 'SENT', 'PENDING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProviderRequestKind" AS ENUM ('SEND', 'STATUS', 'COST', 'BALANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "ProviderRequestStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'DELIVERING', 'SUCCEEDED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'API_KEY', 'SYSTEM');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "rateLimitRpm" INTEGER,
    "maxCsvRows" INTEGER,
    "maxCsvBytes" INTEGER,
    "maxBatchPhones" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "platformRole" "PlatformRole",
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_memberships" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rateLimitRpm" INTEGER,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'RUB',
    "availableBalance" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "heldBalance" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "WalletTransactionType" NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'RUB',
    "balanceAfterAvailable" DECIMAL(18,6),
    "balanceAfterHeld" DECIMAL(18,6),
    "relatedHoldId" TEXT,
    "jobItemId" TEXT,
    "idempotencyKey" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariff_plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'RUB',
    "hlrPrice" DECIMAL(18,6) NOT NULL,
    "pingPrice" DECIMAL(18,6) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tariff_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_tariffs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tariffPlanId" TEXT NOT NULL,
    "hlrPriceOverride" DECIMAL(18,6),
    "pingPriceOverride" DECIMAL(18,6),
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "checkType" "CheckType" NOT NULL,
    "source" "JobSource" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DECIMAL(18,6),
    "actualCost" DECIMAL(18,6),
    "currency" CHAR(3) NOT NULL DEFAULT 'RUB',
    "originalFilename" TEXT,
    "idempotencyKey" TEXT,
    "createdByUserId" TEXT,
    "apiKeyId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_items" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "checkType" "CheckType" NOT NULL,
    "status" "JobItemStatus" NOT NULL DEFAULT 'QUEUED',
    "phoneE164" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL DEFAULT 'smsc',
    "providerMessageId" TEXT,
    "estimatedCost" DECIMAL(18,6),
    "actualCost" DECIMAL(18,6),
    "currency" CHAR(3) NOT NULL DEFAULT 'RUB',
    "resultStatus" TEXT,
    "isReachable" BOOLEAN,
    "imsi" TEXT,
    "mcc" TEXT,
    "mnc" TEXT,
    "operatorName" TEXT,
    "countryCode" TEXT,
    "ported" BOOLEAN,
    "roaming" BOOLEAN,
    "normalizedResult" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobItemId" TEXT,
    "providerCode" TEXT NOT NULL,
    "kind" "ProviderRequestKind" NOT NULL,
    "status" "ProviderRequestStatus" NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "httpStatus" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "requestPayload" JSONB NOT NULL,
    "responsePayload" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_callbacks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "jobItemId" TEXT,
    "providerCode" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "rawPayload" JSONB NOT NULL,
    "signatureValid" BOOLEAN,
    "processedAt" TIMESTAMP(3),
    "processError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_callbacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "jobItemId" TEXT,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "nextAttemptAt" TIMESTAMP(3),
    "lastResponseCode" INTEGER,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "currency" CHAR(3) NOT NULL DEFAULT 'RUB',
    "defaultRateLimitRpm" INTEGER NOT NULL DEFAULT 60,
    "maxCsvRows" INTEGER NOT NULL DEFAULT 100000,
    "maxCsvBytes" INTEGER NOT NULL DEFAULT 52428800,
    "maxBatchPhones" INTEGER NOT NULL DEFAULT 1000,
    "checkTimeoutSec" INTEGER NOT NULL DEFAULT 3600,
    "pollIntervalSec" INTEGER NOT NULL DEFAULT 30,
    "webhookMaxAttempts" INTEGER NOT NULL DEFAULT 8,
    "webhookTimeoutMs" INTEGER NOT NULL DEFAULT 5000,
    "retentionDays" INTEGER NOT NULL DEFAULT 90,
    "smscBaseUrl" TEXT,
    "extras" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "actorType" "ActorType" NOT NULL,
    "actorUserId" TEXT,
    "actorApiKeyId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseCode" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "tenants_status_createdAt_idx" ON "tenants"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_platformRole_idx" ON "users"("platformRole");

-- CreateIndex
CREATE INDEX "tenant_memberships_userId_idx" ON "tenant_memberships"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_memberships_tenantId_userId_key" ON "tenant_memberships"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");

-- CreateIndex
CREATE INDEX "api_keys_tenantId_revokedAt_idx" ON "api_keys"("tenantId", "revokedAt");

-- CreateIndex
CREATE INDEX "api_keys_tenantId_createdAt_idx" ON "api_keys"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_tenantId_key" ON "wallets"("tenantId");

-- CreateIndex
CREATE INDEX "wallet_transactions_walletId_createdAt_idx" ON "wallet_transactions"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "wallet_transactions_tenantId_createdAt_idx" ON "wallet_transactions"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "wallet_transactions_jobItemId_idx" ON "wallet_transactions"("jobItemId");

-- CreateIndex
CREATE INDEX "wallet_transactions_relatedHoldId_idx" ON "wallet_transactions"("relatedHoldId");

-- CreateIndex
CREATE INDEX "wallet_transactions_type_createdAt_idx" ON "wallet_transactions"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_tenantId_idempotencyKey_key" ON "wallet_transactions"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "tariff_plans_code_key" ON "tariff_plans"("code");

-- CreateIndex
CREATE INDEX "tariff_plans_isActive_idx" ON "tariff_plans"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_tariffs_tenantId_key" ON "tenant_tariffs"("tenantId");

-- CreateIndex
CREATE INDEX "tenant_tariffs_tariffPlanId_idx" ON "tenant_tariffs"("tariffPlanId");

-- CreateIndex
CREATE INDEX "jobs_tenantId_createdAt_idx" ON "jobs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "jobs_tenantId_status_idx" ON "jobs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "jobs_status_createdAt_idx" ON "jobs"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_tenantId_idempotencyKey_key" ON "jobs"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "job_items_jobId_status_idx" ON "job_items"("jobId", "status");

-- CreateIndex
CREATE INDEX "job_items_tenantId_createdAt_idx" ON "job_items"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "job_items_tenantId_status_idx" ON "job_items"("tenantId", "status");

-- CreateIndex
CREATE INDEX "job_items_providerCode_providerMessageId_idx" ON "job_items"("providerCode", "providerMessageId");

-- CreateIndex
CREATE INDEX "job_items_phoneE164_idx" ON "job_items"("phoneE164");

-- CreateIndex
CREATE INDEX "provider_requests_jobItemId_createdAt_idx" ON "provider_requests"("jobItemId", "createdAt");

-- CreateIndex
CREATE INDEX "provider_requests_providerCode_providerMessageId_idx" ON "provider_requests"("providerCode", "providerMessageId");

-- CreateIndex
CREATE INDEX "provider_requests_tenantId_createdAt_idx" ON "provider_requests"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "provider_requests_kind_createdAt_idx" ON "provider_requests"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "provider_callbacks_providerCode_providerMessageId_idx" ON "provider_callbacks"("providerCode", "providerMessageId");

-- CreateIndex
CREATE INDEX "provider_callbacks_jobItemId_idx" ON "provider_callbacks"("jobItemId");

-- CreateIndex
CREATE INDEX "provider_callbacks_tenantId_createdAt_idx" ON "provider_callbacks"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "provider_callbacks_createdAt_idx" ON "provider_callbacks"("createdAt");

-- CreateIndex
CREATE INDEX "webhook_endpoints_tenantId_enabled_idx" ON "webhook_endpoints"("tenantId", "enabled");

-- CreateIndex
CREATE INDEX "webhook_deliveries_endpointId_status_idx" ON "webhook_deliveries"("endpointId", "status");

-- CreateIndex
CREATE INDEX "webhook_deliveries_tenantId_createdAt_idx" ON "webhook_deliveries"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_nextAttemptAt_idx" ON "webhook_deliveries"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "webhook_deliveries_jobItemId_idx" ON "webhook_deliveries"("jobItemId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_targetType_targetId_idx" ON "audit_logs"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "idempotency_records_expiresAt_idx" ON "idempotency_records"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_tenantId_key_key" ON "idempotency_records"("tenantId", "key");

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_relatedHoldId_fkey" FOREIGN KEY ("relatedHoldId") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_jobItemId_fkey" FOREIGN KEY ("jobItemId") REFERENCES "job_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_tariffs" ADD CONSTRAINT "tenant_tariffs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_tariffs" ADD CONSTRAINT "tenant_tariffs_tariffPlanId_fkey" FOREIGN KEY ("tariffPlanId") REFERENCES "tariff_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_items" ADD CONSTRAINT "job_items_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_items" ADD CONSTRAINT "job_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_requests" ADD CONSTRAINT "provider_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_requests" ADD CONSTRAINT "provider_requests_jobItemId_fkey" FOREIGN KEY ("jobItemId") REFERENCES "job_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_callbacks" ADD CONSTRAINT "provider_callbacks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_callbacks" ADD CONSTRAINT "provider_callbacks_jobItemId_fkey" FOREIGN KEY ("jobItemId") REFERENCES "job_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_jobItemId_fkey" FOREIGN KEY ("jobItemId") REFERENCES "job_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
