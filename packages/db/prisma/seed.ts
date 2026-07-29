import { hashSync } from 'bcryptjs';

import { PlatformRole, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SUPERADMIN_EMAIL = process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@finenumbers.local';
const SUPERADMIN_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD ?? 'ChangeMeNow!';

/** Legacy bootstrap demo org/user — remove if still present from older seeds. */
async function removeLegacyDemo(): Promise<void> {
  const demoTenant = await prisma.tenant.findUnique({ where: { slug: 'demo' } });
  if (demoTenant) {
    await prisma.tenant.delete({ where: { id: demoTenant.id } });
    console.log('  removed legacy demo tenant');
  }

  const demoUser = await prisma.user.findUnique({
    where: { email: 'demo@finenumbers.local' },
  });
  if (demoUser && demoUser.platformRole == null) {
    await prisma.user.delete({ where: { id: demoUser.id } });
    console.log('  removed legacy demo user');
  }
}

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

  await removeLegacyDemo();

  console.log('Seed completed (empty tenants — create clients in admin):');
  console.log(`  platform settings: default`);
  console.log(`  superadmin: ${superadmin.email} (password from SEED_SUPERADMIN_PASSWORD or default)`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
