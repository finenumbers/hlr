import type { PrismaClient } from '@finenumbers/db';
import { Prisma } from '@finenumbers/db';

import { DEFAULT_JOB_RUNTIME_SETTINGS } from './queue-names.js';
import type { JobsStore } from './ports.js';
import type {
  CreateJobInput,
  JobItemRecord,
  JobRecord,
  JobRuntimeSettings,
} from './types.js';
import { JobsConflictError } from './types.js';

type PrismaLike = Pick<
  PrismaClient,
  'job' | 'jobItem' | 'platformSettings' | 'tenant' | '$transaction' | '$queryRaw'
>;

function decimalToString(
  value: Prisma.Decimal | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return value.toString();
}

function asRecord(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function mapJob(row: {
  id: string;
  tenantId: string;
  checkType: JobRecord['checkType'];
  source: JobRecord['source'];
  status: JobRecord['status'];
  itemCount: number;
  successCount: number;
  failureCount: number;
  estimatedCost: Prisma.Decimal | null;
  actualCost: Prisma.Decimal | null;
  currency: string;
  unitSellPrice: Prisma.Decimal | null;
  unitProviderCost: Prisma.Decimal | null;
  tariffPlanId: string | null;
  tariffPlanCode: string | null;
  originalFilename: string | null;
  idempotencyKey: string | null;
  createdByUserId: string | null;
  apiKeyId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}): JobRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    checkType: row.checkType,
    source: row.source,
    status: row.status,
    itemCount: row.itemCount,
    successCount: row.successCount,
    failureCount: row.failureCount,
    estimatedCost: decimalToString(row.estimatedCost),
    actualCost: decimalToString(row.actualCost),
    currency: row.currency,
    unitSellPrice: decimalToString(row.unitSellPrice),
    unitProviderCost: decimalToString(row.unitProviderCost),
    tariffPlanId: row.tariffPlanId,
    tariffPlanCode: row.tariffPlanCode,
    originalFilename: row.originalFilename,
    idempotencyKey: row.idempotencyKey,
    createdByUserId: row.createdByUserId,
    apiKeyId: row.apiKeyId,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    metadata: asRecord(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapItem(row: {
  id: string;
  jobId: string;
  tenantId: string;
  checkType: JobItemRecord['checkType'];
  status: JobItemRecord['status'];
  phoneE164: string;
  providerCode: string;
  providerMessageId: string | null;
  estimatedCost: Prisma.Decimal | null;
  actualCost: Prisma.Decimal | null;
  currency: string;
  unitSellPrice: Prisma.Decimal | null;
  unitProviderCost: Prisma.Decimal | null;
  tariffPlanId: string | null;
  tariffPlanCode: string | null;
  resultStatus: string | null;
  isReachable: boolean | null;
  imsi: string | null;
  mcc: string | null;
  mnc: string | null;
  operatorName: string | null;
  countryCode: string | null;
  ported: boolean | null;
  roaming: boolean | null;
  normalizedResult: Prisma.JsonValue | null;
  errorCode: string | null;
  errorMessage: string | null;
  billingAction: JobItemRecord['billingAction'];
  sentAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): JobItemRecord {
  return {
    id: row.id,
    jobId: row.jobId,
    tenantId: row.tenantId,
    checkType: row.checkType,
    status: row.status,
    phoneE164: row.phoneE164,
    providerCode: row.providerCode,
    providerMessageId: row.providerMessageId,
    estimatedCost: decimalToString(row.estimatedCost),
    actualCost: decimalToString(row.actualCost),
    currency: row.currency,
    unitSellPrice: decimalToString(row.unitSellPrice),
    unitProviderCost: decimalToString(row.unitProviderCost),
    tariffPlanId: row.tariffPlanId,
    tariffPlanCode: row.tariffPlanCode,
    resultStatus: row.resultStatus,
    isReachable: row.isReachable,
    imsi: row.imsi,
    mcc: row.mcc,
    mnc: row.mnc,
    operatorName: row.operatorName,
    countryCode: row.countryCode,
    ported: row.ported,
    roaming: row.roaming,
    normalizedResult: asRecord(row.normalizedResult),
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    billingAction: row.billingAction,
    sentAt: row.sentAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toJson(
  value: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return Prisma.JsonNull;
  }
  return value as Prisma.InputJsonValue;
}

/** Prisma-backed JobsStore used by api + worker. */
export class PrismaJobsStore implements JobsStore {
  constructor(private readonly prisma: PrismaLike) {}

  async getRuntimeSettings(tenantId: string): Promise<JobRuntimeSettings> {
    const [platform, tenant] = await Promise.all([
      this.prisma.platformSettings.findUnique({ where: { id: 'default' } }),
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          maxBatchPhones: true,
          maxCsvRows: true,
          maxCsvBytes: true,
        },
      }),
    ]);

    return {
      maxBatchPhones:
        tenant?.maxBatchPhones ??
        platform?.maxBatchPhones ??
        DEFAULT_JOB_RUNTIME_SETTINGS.maxBatchPhones,
      maxCsvRows:
        tenant?.maxCsvRows ??
        platform?.maxCsvRows ??
        DEFAULT_JOB_RUNTIME_SETTINGS.maxCsvRows,
      maxCsvBytes:
        tenant?.maxCsvBytes ??
        platform?.maxCsvBytes ??
        DEFAULT_JOB_RUNTIME_SETTINGS.maxCsvBytes,
      checkTimeoutSec:
        platform?.checkTimeoutSec ?? DEFAULT_JOB_RUNTIME_SETTINGS.checkTimeoutSec,
      pollIntervalSec:
        platform?.pollIntervalSec ?? DEFAULT_JOB_RUNTIME_SETTINGS.pollIntervalSec,
      pollMaxAttempts: DEFAULT_JOB_RUNTIME_SETTINGS.pollMaxAttempts,
      submitBatchSize: DEFAULT_JOB_RUNTIME_SETTINGS.submitBatchSize,
    };
  }

  async findJobByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<JobRecord | null> {
    const row = await this.prisma.job.findUnique({
      where: {
        tenantId_idempotencyKey: { tenantId, idempotencyKey },
      },
    });
    return row ? mapJob(row) : null;
  }

  async findJobById(jobId: string): Promise<JobRecord | null> {
    const row = await this.prisma.job.findUnique({ where: { id: jobId } });
    return row ? mapJob(row) : null;
  }

  async createJobWithItems(input: {
    tenantId: string;
    checkType: JobRecord['checkType'];
    source: JobRecord['source'];
    phones: string[];
    idempotencyKey: string | null;
    createdByUserId: string | null;
    apiKeyId: string | null;
    originalFilename: string | null;
    currency: string;
    priceSnapshot?: CreateJobInput['priceSnapshot'];
    metadata: Record<string, unknown> | null;
  }): Promise<{ job: JobRecord; items: JobItemRecord[] }> {
    const snap = input.priceSnapshot ?? null;
    const unitSell = snap?.unitSellPrice ?? null;
    const unitProvider = snap?.unitProviderCost ?? null;
    const created = await this.prisma.job.create({
      data: {
        tenantId: input.tenantId,
        checkType: input.checkType,
        source: input.source,
        status: 'QUEUED',
        itemCount: input.phones.length,
        currency: input.currency,
        unitSellPrice: unitSell,
        unitProviderCost: unitProvider,
        tariffPlanId: snap?.tariffPlanId ?? null,
        tariffPlanCode: snap?.tariffPlanCode ?? null,
        estimatedCost:
          unitSell !== null
            ? new Prisma.Decimal(unitSell).mul(input.phones.length)
            : null,
        originalFilename: input.originalFilename,
        idempotencyKey: input.idempotencyKey,
        createdByUserId: input.createdByUserId,
        apiKeyId: input.apiKeyId,
        metadata: toJson(input.metadata),
        items: {
          create: input.phones.map((phoneE164) => ({
            tenantId: input.tenantId,
            checkType: input.checkType,
            status: 'QUEUED',
            phoneE164,
            currency: input.currency,
            unitSellPrice: unitSell,
            unitProviderCost: unitProvider,
            tariffPlanId: snap?.tariffPlanId ?? null,
            tariffPlanCode: snap?.tariffPlanCode ?? null,
            estimatedCost: unitSell,
          })),
        },
      },
      include: { items: true },
    });

    return {
      job: mapJob(created),
      items: created.items.map(mapItem),
    };
  }

  async createJobShell(input: {
    tenantId: string;
    checkType: JobRecord['checkType'];
    source: JobRecord['source'];
    idempotencyKey: string | null;
    createdByUserId: string | null;
    apiKeyId: string | null;
    originalFilename: string | null;
    currency: string;
    priceSnapshot?: CreateJobInput['priceSnapshot'];
    metadata: Record<string, unknown> | null;
  }): Promise<JobRecord> {
    const snap = input.priceSnapshot ?? null;
    if (!snap?.unitSellPrice || !snap.unitProviderCost || !snap.tariffPlanId || !snap.tariffPlanCode) {
      throw new Error(
        'createJobShell requires a full priceSnapshot (unitSellPrice, unitProviderCost, tariffPlanId, tariffPlanCode)',
      );
    }
    const created = await this.prisma.job.create({
      data: {
        tenantId: input.tenantId,
        checkType: input.checkType,
        source: input.source,
        status: 'QUEUED',
        itemCount: 0,
        currency: input.currency,
        unitSellPrice: snap?.unitSellPrice ?? null,
        unitProviderCost: snap?.unitProviderCost ?? null,
        tariffPlanId: snap?.tariffPlanId ?? null,
        tariffPlanCode: snap?.tariffPlanCode ?? null,
        originalFilename: input.originalFilename,
        idempotencyKey: input.idempotencyKey,
        createdByUserId: input.createdByUserId,
        apiKeyId: input.apiKeyId,
        metadata: toJson(input.metadata),
      },
    });
    return mapJob(created);
  }

  async attachItemsToJob(input: {
    jobId: string;
    tenantId: string;
    checkType: JobRecord['checkType'];
    phones: string[];
    currency: string;
  }): Promise<{ job: JobRecord; items: JobItemRecord[] }> {
    const CHUNK = 1_000;
    const allItems: JobItemRecord[] = [];
    const jobRow = await this.prisma.job.findUnique({ where: { id: input.jobId } });
    if (!jobRow) {
      throw new Error(`Job ${input.jobId} not found`);
    }

    await this.prisma.$transaction(
      async (tx) => {
        for (let i = 0; i < input.phones.length; i += CHUNK) {
          const slice = input.phones.slice(i, i + CHUNK);
          await tx.jobItem.createMany({
            data: slice.map((phoneE164) => ({
              jobId: input.jobId,
              tenantId: input.tenantId,
              checkType: input.checkType,
              status: 'QUEUED' as const,
              phoneE164,
              currency: input.currency,
              unitSellPrice: jobRow.unitSellPrice,
              unitProviderCost: jobRow.unitProviderCost,
              tariffPlanId: jobRow.tariffPlanId,
              tariffPlanCode: jobRow.tariffPlanCode,
              estimatedCost: jobRow.unitSellPrice,
            })),
          });
        }
        const prevMeta = asRecord(jobRow.metadata) ?? {};
        await tx.job.update({
          where: { id: input.jobId },
          data: {
            itemCount: input.phones.length,
            status: 'QUEUED',
            estimatedCost:
              jobRow.unitSellPrice !== null
                ? jobRow.unitSellPrice.mul(input.phones.length)
                : null,
            metadata: toJson({
              ...prevMeta,
              csvPending: false,
              csvAttachedAt: new Date().toISOString(),
            }),
          },
        });
      },
      { timeout: 120_000, maxWait: 20_000 },
    );

    const rows = await this.prisma.jobItem.findMany({
      where: { jobId: input.jobId },
      orderBy: { createdAt: 'asc' },
    });
    allItems.push(...rows.map(mapItem));
    const job = await this.findJobById(input.jobId);
    if (!job) {
      throw new Error(`Job ${input.jobId} missing after attachItemsToJob`);
    }
    return { job, items: allItems };
  }

  async deleteJobCascade(jobId: string): Promise<void> {
    try {
      await this.prisma.job.delete({ where: { id: jobId } });
    } catch (error) {
      // Already gone (P2025) — treat as success for rollback callers.
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: string }).code === 'P2025'
      ) {
        return;
      }
      throw error;
    }
  }

  async patchJobMetadata(
    jobId: string,
    patch: Record<string, unknown>,
  ): Promise<JobRecord | null> {
    const row = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!row) return null;
    const prev = asRecord(row.metadata) ?? {};
    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: { metadata: toJson({ ...prev, ...patch }) },
    });
    return mapJob(updated);
  }

  async listItemsByIds(itemIds: string[]): Promise<JobItemRecord[]> {
    if (itemIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.jobItem.findMany({
      where: { id: { in: itemIds } },
    });
    const byId = new Map(rows.map((row) => [row.id, mapItem(row)]));
    return itemIds.map((id) => byId.get(id)).filter((x): x is JobItemRecord => Boolean(x));
  }

  async listItemsByJobId(jobId: string): Promise<JobItemRecord[]> {
    const rows = await this.prisma.jobItem.findMany({ where: { jobId } });
    return rows.map(mapItem);
  }

  async listQueuedItemIdsByJobId(jobId: string): Promise<string[]> {
    const rows = await this.prisma.jobItem.findMany({
      where: { jobId, status: 'QUEUED' },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => row.id);
  }

  async findItemById(jobItemId: string): Promise<JobItemRecord | null> {
    const row = await this.prisma.jobItem.findUnique({ where: { id: jobItemId } });
    return row ? mapItem(row) : null;
  }

  async findItemByProviderMessageId(input: {
    providerCode: string;
    providerMessageId: string;
    tenantId?: string;
    phoneE164?: string | null;
  }): Promise<JobItemRecord | null> {
    const phoneDigits = input.phoneE164
      ? input.phoneE164.replace(/\D/g, '')
      : null;
    const rows = await this.prisma.jobItem.findMany({
      where: {
        providerCode: input.providerCode,
        providerMessageId: input.providerMessageId,
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    if (rows.length === 0) {
      return null;
    }
    const matched = phoneDigits
      ? rows.filter((row) => row.phoneE164.replace(/\D/g, '') === phoneDigits)
      : rows;
    if (matched.length === 0) {
      return null;
    }
    if (matched.length > 1) {
      throw new JobsConflictError(
        `Ambiguous providerMessageId ${input.providerMessageId} matches ${matched.length} items`,
      );
    }
    return mapItem(matched[0]!);
  }

  async claimItemForSubmit(jobItemId: string): Promise<JobItemRecord | null> {
    const reserved = await this.prisma.jobItem.updateMany({
      where: { id: jobItemId, status: 'QUEUED' },
      data: { status: 'RESERVED' },
    });
    if (reserved.count === 0) {
      const existing = await this.prisma.jobItem.findUnique({
        where: { id: jobItemId },
      });
      // Allow re-submit after retryable BullMQ failure while still RESERVED.
      if (existing?.status === 'RESERVED') {
        return mapItem(existing);
      }
      return null;
    }
    const row = await this.prisma.jobItem.findUnique({ where: { id: jobItemId } });
    return row ? mapItem(row) : null;
  }

  async markJobProcessing(jobId: string): Promise<JobRecord | null> {
    await this.prisma.job.updateMany({
      where: { id: jobId, status: 'QUEUED' },
      data: { status: 'PROCESSING', startedAt: new Date() },
    });
    return this.findJobById(jobId);
  }

  async updateItemAfterSubmit(input: {
    jobItemId: string;
    status: 'SENT' | 'PENDING' | 'COMPLETED' | 'FAILED';
    providerMessageId: string | null;
    providerCode: string;
    normalizedResult?: Record<string, unknown> | null;
    resultStatus?: string | null;
    isReachable?: boolean | null;
    imsi?: string | null;
    mcc?: string | null;
    mnc?: string | null;
    operatorName?: string | null;
    countryCode?: string | null;
    ported?: boolean | null;
    roaming?: boolean | null;
    actualCost?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    billingAction?: JobItemRecord['billingAction'];
    sentAt?: Date | null;
    completedAt?: Date | null;
  }): Promise<JobItemRecord | null> {
    const updated = await this.prisma.jobItem.updateMany({
      where: {
        id: input.jobItemId,
        status: { in: ['RESERVED', 'SENT'] },
      },
      data: {
        status: input.status,
        providerMessageId: input.providerMessageId,
        providerCode: input.providerCode,
        normalizedResult: toJson(input.normalizedResult),
        resultStatus: input.resultStatus,
        isReachable: input.isReachable,
        imsi: input.imsi,
        mcc: input.mcc,
        mnc: input.mnc,
        operatorName: input.operatorName,
        countryCode: input.countryCode,
        ported: input.ported,
        roaming: input.roaming,
        actualCost:
          input.actualCost === undefined
            ? undefined
            : input.actualCost === null
              ? null
              : new Prisma.Decimal(input.actualCost),
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        billingAction: input.billingAction,
        sentAt: input.sentAt,
        completedAt: input.completedAt,
      },
    });
    // No-op: another worker already moved the item out of RESERVED/SENT.
    // Return null so lifecycle does not re-run capture/release on a stale loser.
    if (updated.count === 0) {
      return null;
    }
    return this.findItemById(input.jobItemId);
  }

  async transitionItem(input: {
    jobItemId: string;
    fromStatuses: Array<JobItemRecord['status']>;
    toStatus: JobItemRecord['status'];
    patch: Partial<{
      providerMessageId: string | null;
      normalizedResult: Record<string, unknown> | null;
      resultStatus: string | null;
      isReachable: boolean | null;
      imsi: string | null;
      mcc: string | null;
      mnc: string | null;
      operatorName: string | null;
      countryCode: string | null;
      ported: boolean | null;
      roaming: boolean | null;
      actualCost: string | null;
      errorCode: string | null;
      errorMessage: string | null;
      billingAction: JobItemRecord['billingAction'];
      sentAt: Date | null;
      completedAt: Date | null;
    }>;
  }): Promise<JobItemRecord | null> {
    const data: Prisma.JobItemUpdateManyMutationInput = {
      status: input.toStatus,
    };
    if (input.patch.providerMessageId !== undefined) {
      data.providerMessageId = input.patch.providerMessageId;
    }
    if (input.patch.normalizedResult !== undefined) {
      data.normalizedResult = toJson(input.patch.normalizedResult);
    }
    if (input.patch.resultStatus !== undefined) {
      data.resultStatus = input.patch.resultStatus;
    }
    if (input.patch.isReachable !== undefined) {
      data.isReachable = input.patch.isReachable;
    }
    if (input.patch.imsi !== undefined) data.imsi = input.patch.imsi;
    if (input.patch.mcc !== undefined) data.mcc = input.patch.mcc;
    if (input.patch.mnc !== undefined) data.mnc = input.patch.mnc;
    if (input.patch.operatorName !== undefined) {
      data.operatorName = input.patch.operatorName;
    }
    if (input.patch.countryCode !== undefined) {
      data.countryCode = input.patch.countryCode;
    }
    if (input.patch.ported !== undefined) data.ported = input.patch.ported;
    if (input.patch.roaming !== undefined) data.roaming = input.patch.roaming;
    if (input.patch.actualCost !== undefined) {
      data.actualCost =
        input.patch.actualCost === null
          ? null
          : new Prisma.Decimal(input.patch.actualCost);
    }
    if (input.patch.errorCode !== undefined) data.errorCode = input.patch.errorCode;
    if (input.patch.errorMessage !== undefined) {
      data.errorMessage = input.patch.errorMessage;
    }
    if (input.patch.billingAction !== undefined) {
      data.billingAction = input.patch.billingAction;
    }
    if (input.patch.sentAt !== undefined) data.sentAt = input.patch.sentAt;
    if (input.patch.completedAt !== undefined) {
      data.completedAt = input.patch.completedAt;
    }

    const result = await this.prisma.jobItem.updateMany({
      where: {
        id: input.jobItemId,
        status: { in: input.fromStatuses },
      },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.findItemById(input.jobItemId);
  }

  async refreshJobCounters(jobId: string): Promise<JobRecord> {
    const [successCount, failureCount, itemCount] = await Promise.all([
      this.prisma.jobItem.count({
        where: { jobId, status: 'COMPLETED' },
      }),
      this.prisma.jobItem.count({
        where: { jobId, status: { in: ['FAILED', 'CANCELLED'] } },
      }),
      this.prisma.jobItem.count({ where: { jobId } }),
    ]);

    const row = await this.prisma.job.update({
      where: { id: jobId },
      data: { successCount, failureCount, itemCount },
    });
    return mapJob(row);
  }

  async finalizeJob(input: {
    jobId: string;
    status: JobRecord['status'];
    errorCode?: string | null;
    errorMessage?: string | null;
  }): Promise<JobRecord | null> {
    const result = await this.prisma.job.updateMany({
      where: {
        id: input.jobId,
        status: { in: ['QUEUED', 'PROCESSING'] },
      },
      data: {
        status: input.status,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        completedAt: new Date(),
      },
    });
    if (result.count === 0) {
      return this.findJobById(input.jobId);
    }
    return this.findJobById(input.jobId);
  }

  async listStalePendingItems(input: {
    olderThan: Date;
    limit: number;
  }): Promise<JobItemRecord[]> {
    const rows = await this.prisma.jobItem.findMany({
      where: {
        status: { in: ['PENDING', 'SENT'] },
        updatedAt: { lt: input.olderThan },
      },
      orderBy: { updatedAt: 'asc' },
      take: input.limit,
    });
    return rows.map(mapItem);
  }

  async listStaleReservedItems(input: {
    olderThan: Date;
    limit: number;
  }): Promise<JobItemRecord[]> {
    const rows = await this.prisma.jobItem.findMany({
      where: {
        status: 'RESERVED',
        updatedAt: { lt: input.olderThan },
      },
      orderBy: { updatedAt: 'asc' },
      take: input.limit,
    });
    return rows.map(mapItem);
  }

  async listJobsNeedingFinalize(input: { limit: number }): Promise<JobRecord[]> {
    const limit = Math.max(1, Math.min(input.limit, 2_000));
    const ids = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT j.id
      FROM jobs j
      WHERE j.status IN ('QUEUED'::"JobStatus", 'PROCESSING'::"JobStatus")
        AND j."itemCount" > 0
        AND NOT EXISTS (
          SELECT 1
          FROM job_items i
          WHERE i."jobId" = j.id
            AND i.status IN (
              'QUEUED'::"JobItemStatus",
              'RESERVED'::"JobItemStatus",
              'SENT'::"JobItemStatus",
              'PENDING'::"JobItemStatus"
            )
        )
      ORDER BY j."updatedAt" ASC
      LIMIT ${limit}
    `;
    if (ids.length === 0) {
      return [];
    }
    const jobs = await this.prisma.job.findMany({
      where: { id: { in: ids.map((row) => row.id) } },
    });
    const byId = new Map(jobs.map((job) => [job.id, job]));
    return ids
      .map((row) => {
        const job = byId.get(row.id);
        return job ? mapJob(job) : null;
      })
      .filter((job): job is JobRecord => job !== null);
  }

  async listJobsNeedingSubmitResume(input: {
    olderThan: Date;
    limit: number;
  }): Promise<JobRecord[]> {
    const limit = Math.max(1, Math.min(input.limit, 2_000));
    const ids = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT j.id
      FROM jobs j
      WHERE j.status IN ('QUEUED'::"JobStatus", 'PROCESSING'::"JobStatus")
        AND j."itemCount" > 0
        AND EXISTS (
          SELECT 1
          FROM job_items i
          WHERE i."jobId" = j.id
            AND i.status = 'QUEUED'::"JobItemStatus"
            AND i."updatedAt" < ${input.olderThan}
        )
      ORDER BY j."updatedAt" ASC
      LIMIT ${limit}
    `;
    if (ids.length === 0) {
      return [];
    }
    const jobs = await this.prisma.job.findMany({
      where: { id: { in: ids.map((row) => row.id) } },
    });
    const byId = new Map(jobs.map((job) => [job.id, job]));
    return ids
      .map((row) => {
        const job = byId.get(row.id);
        return job ? mapJob(job) : null;
      })
      .filter((job): job is JobRecord => job !== null);
  }

  async listEmptyCsvShellsNeedingHeal(input: {
    olderThan: Date;
    limit: number;
  }): Promise<JobRecord[]> {
    const limit = Math.max(1, Math.min(input.limit, 2_000));
    const rows = await this.prisma.job.findMany({
      where: {
        status: { in: ['QUEUED', 'PROCESSING'] },
        itemCount: 0,
        updatedAt: { lt: input.olderThan },
        metadata: {
          path: ['csvPending'],
          equals: true,
        },
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    return rows.map(mapJob);
  }
}
