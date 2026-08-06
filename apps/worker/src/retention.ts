import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import type { PrismaClient } from '@finenumbers/db';

import { workerLogger } from './logger';

const RETAINED_PLACEHOLDER = { retained: false } as const;

/** Default orphan CSV upload TTL (hours). Immediate unlink happens after parse. */
const DEFAULT_UPLOAD_RETENTION_HOURS = 24;

/**
 * Delete/redact provider & webhook payloads older than PlatformSettings.retentionDays.
 * Keeps Job/JobItem/billing history intact.
 * Also sweeps orphan files under UPLOAD_DIR (crash leftovers / .tmp).
 */
export async function runRetentionSweep(
  prisma: PrismaClient,
  options: { uploadDir?: string; uploadRetentionHours?: number } = {},
): Promise<{
  providerRequestsDeleted: number;
  providerCallbacksDeleted: number;
  webhookPayloadsRedacted: number;
  idempotencyDeleted: number;
  uploadFilesDeleted: number;
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

  const uploadFilesDeleted = await sweepUploadDir({
    uploadDir: options.uploadDir ?? process.env.UPLOAD_DIR ?? './data/uploads',
    retentionHours:
      options.uploadRetentionHours ??
      Number(process.env.UPLOAD_RETENTION_HOURS ?? DEFAULT_UPLOAD_RETENTION_HOURS),
  });

  const result = {
    providerRequestsDeleted: providerRequests.count,
    providerCallbacksDeleted: providerCallbacks.count,
    webhookPayloadsRedacted: webhookUpdate.count,
    idempotencyDeleted: idempotency.count,
    uploadFilesDeleted,
    cutoffIso: cutoff.toISOString(),
  };

  workerLogger.info('jobs.retention.sweep_complete', {
    retentionDays,
    ...result,
  });

  return result;
}

async function sweepUploadDir(input: {
  uploadDir: string;
  retentionHours: number;
}): Promise<number> {
  const hours = Number.isFinite(input.retentionHours)
    ? Math.max(1, input.retentionHours)
    : DEFAULT_UPLOAD_RETENTION_HOURS;
  const cutoffMs = Date.now() - hours * 60 * 60 * 1000;
  let deleted = 0;
  let entries: string[];
  try {
    entries = await readdir(input.uploadDir);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : '';
    if (code === 'ENOENT') return 0;
    workerLogger.warn('jobs.retention.upload_dir_unreadable', {
      uploadDir: input.uploadDir,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }

  for (const name of entries) {
    const path = join(input.uploadDir, name);
    try {
      const info = await stat(path);
      if (!info.isFile()) continue;
      if (info.mtimeMs >= cutoffMs) continue;
      await unlink(path);
      deleted += 1;
    } catch {
      // Best-effort orphan cleanup.
    }
  }
  return deleted;
}
