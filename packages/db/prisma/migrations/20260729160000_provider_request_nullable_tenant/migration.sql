-- Platform-level SMSC probes (BALANCE / admin COST) have no tenant.
ALTER TABLE "provider_requests" DROP CONSTRAINT "provider_requests_tenantId_fkey";

ALTER TABLE "provider_requests" ALTER COLUMN "tenantId" DROP NOT NULL;

ALTER TABLE "provider_requests" ADD CONSTRAINT "provider_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
