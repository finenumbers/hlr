import type { PrismaClient } from '@finenumbers/db';

export type ResolvedLimits = {
  rateLimitRpm: number;
  maxCsvRows: number;
  maxCsvBytes: number;
  maxBatchPhones: number;
  source: {
    rateLimitRpm: 'api_key' | 'tenant' | 'platform';
  };
};

/**
 * Cascade: API key override → tenant override → PlatformSettings.
 * Minimal resolveLimits for public API RPM / batch caps (full settings CRUD = E06).
 */
export async function resolveLimits(
  prisma: PrismaClient,
  input: { tenantId: string; apiKeyRateLimitRpm?: number | null },
): Promise<ResolvedLimits> {
  const [tenant, platform] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: {
        rateLimitRpm: true,
        maxCsvRows: true,
        maxCsvBytes: true,
        maxBatchPhones: true,
      },
    }),
    prisma.platformSettings.findUnique({
      where: { id: 'default' },
      select: {
        defaultRateLimitRpm: true,
        maxCsvRows: true,
        maxCsvBytes: true,
        maxBatchPhones: true,
      },
    }),
  ]);

  const platformRpm = platform?.defaultRateLimitRpm ?? 60;
  let rateLimitRpm = platformRpm;
  let rpmSource: ResolvedLimits['source']['rateLimitRpm'] = 'platform';

  if (tenant?.rateLimitRpm != null) {
    rateLimitRpm = tenant.rateLimitRpm;
    rpmSource = 'tenant';
  }
  if (input.apiKeyRateLimitRpm != null) {
    rateLimitRpm = input.apiKeyRateLimitRpm;
    rpmSource = 'api_key';
  }

  return {
    rateLimitRpm,
    maxCsvRows: tenant?.maxCsvRows ?? platform?.maxCsvRows ?? 100_000,
    maxCsvBytes: tenant?.maxCsvBytes ?? platform?.maxCsvBytes ?? 52_428_800,
    maxBatchPhones: tenant?.maxBatchPhones ?? platform?.maxBatchPhones ?? 1_000,
    source: { rateLimitRpm: rpmSource },
  };
}
