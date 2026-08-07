import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { Prisma, type PrismaClient } from '@finenumbers/db';

import { workerLogger } from './logger';

const RETAINED_PLACEHOLDER = { retained: false } as const;

/** Default orphan CSV upload TTL (hours). Parsed files are unlinked after attach. */
const DEFAULT_UPLOAD_RETENTION_HOURS = 24;

/**
 * Delete/redact provider & webhook payloads older than PlatformSettings.retentionDays.
 * Keeps Job/JobItem/billing history intact.
 * Also sweeps orphan files under UPLOAD_DIR (tenant dirs + .tmp).
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

  const protectedPaths = await loadProtectedUploadPaths(prisma);
  const uploadFilesDeleted = await sweepUploadDir({
    uploadDir: options.uploadDir ?? process.env.UPLOAD_DIR ?? './data/uploads',
    retentionHours:
      options.uploadRetentionHours ??
      Number(process.env.UPLOAD_RETENTION_HOURS ?? DEFAULT_UPLOAD_RETENTION_HOURS),
    protectedPaths,
  });

  // Expire / purge cabinet CSV preview drafts (PII phonesJson).
  const now = new Date();
  await prisma.csvPreview.updateMany({
    where: { status: 'READY', expiresAt: { lt: now } },
    data: { status: 'EXPIRED', phonesJson: Prisma.DbNull },
  });
  const csvPreviewsDeleted = await prisma.csvPreview.deleteMany({
    where: {
      OR: [
        { status: { in: ['EXPIRED', 'CONSUMED', 'INVALID'] }, expiresAt: { lt: now } },
        { createdAt: { lt: cutoff } },
      ],
    },
  });

  const result = {
    providerRequestsDeleted: providerRequests.count,
    providerCallbacksDeleted: providerCallbacks.count,
    webhookPayloadsRedacted: webhookUpdate.count,
    idempotencyDeleted: idempotency.count,
    uploadFilesDeleted,
    csvPreviewsDeleted: csvPreviewsDeleted.count,
    cutoffIso: cutoff.toISOString(),
  };

  workerLogger.info('jobs.retention.sweep_complete', {
    retentionDays,
    ...result,
  });

  return result;
}

async function loadProtectedUploadPaths(prisma: PrismaClient): Promise<Set<string>> {
  const rows = await prisma.job.findMany({
    where: {
      status: { in: ['QUEUED', 'PROCESSING'] },
      itemCount: 0,
    },
    select: { metadata: true },
    take: 5_000,
  });
  const paths = new Set<string>();
  for (const row of rows) {
    const meta = row.metadata;
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) continue;
    const record = meta as Record<string, unknown>;
    if (record.csvPending !== true) continue;
    if (typeof record.csvFilePath === 'string' && record.csvFilePath.length > 0) {
      paths.add(record.csvFilePath);
    }
  }
  return paths;
}

async function sweepUploadDir(input: {
  uploadDir: string;
  retentionHours: number;
  protectedPaths: Set<string>;
}): Promise<number> {
  const hours = Number.isFinite(input.retentionHours)
    ? Math.max(1, input.retentionHours)
    : DEFAULT_UPLOAD_RETENTION_HOURS;
  const cutoffMs = Date.now() - hours * 60 * 60 * 1000;
  let deleted = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 3) return;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code: unknown }).code)
          : '';
      if (code === 'ENOENT') return;
      workerLogger.warn('jobs.retention.upload_dir_unreadable', {
        uploadDir: dir,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    for (const name of entries) {
      if (name === '.' || name === '..') continue;
      const path = join(dir, name);
      try {
        const info = await stat(path);
        if (info.isDirectory()) {
          await walk(path, depth + 1);
          continue;
        }
        if (!info.isFile()) continue;
        if (info.mtimeMs >= cutoffMs) continue;
        if (input.protectedPaths.has(path)) continue;
        await unlink(path);
        deleted += 1;
      } catch {
        // Best-effort orphan cleanup.
      }
    }
  }

  await walk(input.uploadDir, 0);
  return deleted;
}
