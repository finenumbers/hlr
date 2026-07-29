import type { PrismaClient } from '@finenumbers/db';

import { workerLogger } from './logger';

const RETAINED_PLACEHOLDER = { retained: false } as const;

/**
 * Delete/redact provider & webhook payloads older than PlatformSettings.retentionDays.
 * Keeps Job/JobItem/billing history intact.
 */
export async function runRetentionSweep(
  prisma: PrismaClient,
): Promise<{
  providerRequestsDeleted: number;
  providerCallbacksDeleted: number;
  webhookPayloadsRedacted: number;
  idempotencyDeleted: number;
  cutoffIso: string;
}> {
  const settings = await prisma.platformSettings.findUnique({
    where: { id: 'default' },
  });
  const retentionDays = settings?.retentionDays ?? 90;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const [providerRequests, providerCallbacks, webhookUpdate, idempotency] =
    await prisma.$transaction([
      prisma.providerRequest.deleteMany({
        where: { createdAt: { lt: cutoff } },
      }),
      prisma.providerCallback.deleteMany({
        where: { createdAt: { lt: cutoff } },
      }),
      prisma.webhookDelivery.updateMany({
        where: { createdAt: { lt: cutoff } },
        data: { payload: RETAINED_PLACEHOLDER },
      }),
      prisma.idempotencyRecord.deleteMany({
        where: {
          OR: [{ expiresAt: { lt: new Date() } }, { createdAt: { lt: cutoff } }],
        },
      }),
    ]);

  const result = {
    providerRequestsDeleted: providerRequests.count,
    providerCallbacksDeleted: providerCallbacks.count,
    webhookPayloadsRedacted: webhookUpdate.count,
    idempotencyDeleted: idempotency.count,
    cutoffIso: cutoff.toISOString(),
  };

  workerLogger.info('jobs.retention.sweep_complete', {
    retentionDays,
    ...result,
  });

  return result;
}
