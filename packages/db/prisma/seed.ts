import { hashSync } from 'bcryptjs';

import { MembershipRole, PlatformRole, PrismaClient, TenantStatus } from '@prisma/client';

const prisma = new PrismaClient();

const SUPERADMIN_EMAIL = process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@finenumbers.local';
const SUPERADMIN_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD ?? 'ChangeMeNow!';
const DEMO_ADMIN_EMAIL = process.env.SEED_DEMO_ADMIN_EMAIL ?? 'demo@finenumbers.local';
const DEMO_ADMIN_PASSWORD = process.env.SEED_DEMO_ADMIN_PASSWORD ?? 'ChangeMeNow!';

async function main(): Promise<void> {
  await prisma.platformSettings.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      currency: 'RUB',
      defaultRateLimitRpm: 60,
      maxCsvRows: 100_000,
      maxCsvBytes: 52_428_800,
      maxBatchPhones: 1_000,
      checkTimeoutSec: 3_600,
      pollIntervalSec: 30,
      webhookMaxAttempts: 8,
      webhookTimeoutMs: 5_000,
      retentionDays: 90,
    },
    update: {},
  });

  const superadmin = await prisma.user.upsert({
    where: { email: SUPERADMIN_EMAIL },
    create: {
      email: SUPERADMIN_EMAIL,
      name: 'Platform Superadmin',
      passwordHash: hashSync(SUPERADMIN_PASSWORD, 12),
      platformRole: PlatformRole.SUPERADMIN,
      isActive: true,
    },
    update: {
      platformRole: PlatformRole.SUPERADMIN,
      isActive: true,
      // Re-seed resets bootstrap password from env (Portainer first boot / recovery).
      passwordHash: hashSync(SUPERADMIN_PASSWORD, 12),
    },
  });

  const demoTenant = await prisma.tenant.upsert({
    where: { slug: 'demo' },
    create: {
      slug: 'demo',
      name: 'Demo Tenant',
      status: TenantStatus.ACTIVE,
    },
    update: {
      name: 'Demo Tenant',
      status: TenantStatus.ACTIVE,
    },
  });

  await prisma.wallet.upsert({
    where: { tenantId: demoTenant.id },
    create: {
      tenantId: demoTenant.id,
      currency: 'RUB',
      // Decimal strings — never JS float for money columns.
      availableBalance: '0',
      heldBalance: '0',
    },
    update: {},
  });

  const demoAdmin = await prisma.user.upsert({
    where: { email: DEMO_ADMIN_EMAIL },
    create: {
      email: DEMO_ADMIN_EMAIL,
      name: 'Demo Tenant Admin',
      passwordHash: hashSync(DEMO_ADMIN_PASSWORD, 12),
      isActive: true,
    },
    update: {
      isActive: true,
      name: 'Demo Tenant Admin',
      passwordHash: hashSync(DEMO_ADMIN_PASSWORD, 12),
    },
  });

  await prisma.tenantMembership.upsert({
    where: {
      tenantId_userId: {
        tenantId: demoTenant.id,
        userId: demoAdmin.id,
      },
    },
    create: {
      tenantId: demoTenant.id,
      userId: demoAdmin.id,
      role: MembershipRole.OWNER,
    },
    update: {
      role: MembershipRole.OWNER,
    },
  });

  console.log('Seed completed:');
  console.log(`  platform settings: default`);
  console.log(`  superadmin: ${superadmin.email} (password from SEED_SUPERADMIN_PASSWORD or default)`);
  console.log(`  demo tenant: ${demoTenant.slug} (${demoTenant.id})`);
  console.log(`  demo admin: ${demoAdmin.email} (password from SEED_DEMO_ADMIN_PASSWORD or default)`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
