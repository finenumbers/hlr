import { hashSync } from 'bcryptjs';

import { PlatformRole, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SUPERADMIN_EMAIL = (
  process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@finenumbers.local'
)
  .trim()
  .toLowerCase();
const SUPERADMIN_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD ?? 'ChangeMeNow!';
const WEAK_DEFAULT_PASSWORD = 'ChangeMeNow!';
const RESET_PASSWORD = process.env.SEED_RESET_PASSWORD === 'true';
const IS_PRODUCTION =
  process.env.NODE_ENV === 'production' ||
  process.env.SEED_REQUIRE_STRONG_PASSWORD === 'true';

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

function assertPasswordPolicy(): void {
  if (!SUPERADMIN_PASSWORD || SUPERADMIN_PASSWORD.length < 8) {
    throw new Error('SEED_SUPERADMIN_PASSWORD must be at least 8 characters');
  }
  if (
    IS_PRODUCTION &&
    (SUPERADMIN_PASSWORD === WEAK_DEFAULT_PASSWORD || SUPERADMIN_PASSWORD.length < 16)
  ) {
    throw new Error(
      'SEED_SUPERADMIN_PASSWORD must be a strong secret in production ' +
        '(≠ ChangeMeNow!, length ≥ 16). Set it in Portainer/env before migrate.',
    );
  }
}

async function main(): Promise<void> {
  if (!SUPERADMIN_EMAIL || !SUPERADMIN_EMAIL.includes('@')) {
    throw new Error(`Invalid SEED_SUPERADMIN_EMAIL: ${SUPERADMIN_EMAIL}`);
  }
  assertPasswordPolicy();

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

  const existing = await prisma.user.findUnique({
    where: { email: SUPERADMIN_EMAIL },
  });

  if (!existing) {
    await prisma.user.create({
      data: {
        email: SUPERADMIN_EMAIL,
        name: 'Platform Superadmin',
        passwordHash: hashSync(SUPERADMIN_PASSWORD, 12),
        platformRole: PlatformRole.SUPERADMIN,
        isActive: true,
      },
    });
    console.log(`  created superadmin ${SUPERADMIN_EMAIL}`);
  } else {
    const updateData: {
      platformRole: typeof PlatformRole.SUPERADMIN;
      isActive: boolean;
      passwordHash?: string;
    } = {
      platformRole: PlatformRole.SUPERADMIN,
      isActive: true,
    };
    if (RESET_PASSWORD) {
      updateData.passwordHash = hashSync(SUPERADMIN_PASSWORD, 12);
      console.log(`  reset password for ${SUPERADMIN_EMAIL} (SEED_RESET_PASSWORD=true)`);
    }
    await prisma.user.update({
      where: { email: SUPERADMIN_EMAIL },
      data: updateData,
    });
  }

  await demoteLegacyDefaultAdmin();
  await removeLegacyDemo();

  console.log('Seed completed (empty tenants — create clients in admin):');
  console.log(`  platform settings: default`);
  console.log(`  superadmin: ${SUPERADMIN_EMAIL}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
