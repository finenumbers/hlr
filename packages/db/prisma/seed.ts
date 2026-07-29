import { hashSync } from 'bcryptjs';

import { PlatformRole, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SUPERADMIN_EMAIL = (
  process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@finenumbers.local'
)
  .trim()
  .toLowerCase();
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

/**
 * If SEED email changed away from the old default, demote the leftover
 * admin@finenumbers.local so operators are not confused by two superadmins.
 */
async function demoteLegacyDefaultAdmin(): Promise<void> {
  const legacyEmail = 'admin@finenumbers.local';
  if (SUPERADMIN_EMAIL === legacyEmail) {
    return;
  }

  const legacy = await prisma.user.findUnique({ where: { email: legacyEmail } });
  if (!legacy || legacy.platformRole !== PlatformRole.SUPERADMIN) {
    return;
  }

  await prisma.user.update({
    where: { id: legacy.id },
    data: { platformRole: null, isActive: false },
  });
  console.log(`  demoted legacy superadmin ${legacyEmail}`);
}

async function main(): Promise<void> {
  if (!SUPERADMIN_EMAIL || !SUPERADMIN_EMAIL.includes('@')) {
    throw new Error(`Invalid SEED_SUPERADMIN_EMAIL: ${SUPERADMIN_EMAIL}`);
  }
  if (!SUPERADMIN_PASSWORD || SUPERADMIN_PASSWORD.length < 8) {
    throw new Error('SEED_SUPERADMIN_PASSWORD must be at least 8 characters');
  }

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

  await demoteLegacyDefaultAdmin();
  await removeLegacyDemo();

  console.log('Seed completed (empty tenants — create clients in admin):');
  console.log(`  platform settings: default`);
  console.log(`  superadmin email: ${superadmin.email}`);
  console.log(`  superadmin password: from SEED_SUPERADMIN_PASSWORD (${SUPERADMIN_PASSWORD.length} chars)`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
