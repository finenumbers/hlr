import type { PrismaClient } from '@finenumbers/db';
import { Prisma } from '@finenumbers/db';

import { DEFAULT_JOB_RUNTIME_SETTINGS } from './queue-names.js';
import type { JobsStore } from './ports.js';
import type {
  JobItemRecord,
  JobRecord,
  JobRuntimeSettings,
} from './types.js';

type PrismaLike = Pick<
  PrismaClient,
  'job' | 'jobItem' | 'platformSettings' | 'tenant' | '$transaction'
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
        select: { maxBatchPhones: true },
      }),
    ]);

    return {
      maxBatchPhones:
        tenant?.maxBatchPhones ??
        platform?.maxBatchPhones ??
        DEFAULT_JOB_RUNTIME_SETTINGS.maxBatchPhones,
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
    metadata: Record<string, unknown> | null;
  }): Promise<{ job: JobRecord; items: JobItemRecord[] }> {
    const created = await this.prisma.job.create({
      data: {
        tenantId: input.tenantId,
        checkType: input.checkType,
        source: input.source,
        status: 'QUEUED',
        itemCount: input.phones.length,
        currency: input.currency,
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

  async findItemById(jobItemId: string): Promise<JobItemRecord | null> {
    const row = await this.prisma.jobItem.findUnique({ where: { id: jobItemId } });
    return row ? mapItem(row) : null;
  }

  async findItemByProviderMessageId(input: {
    providerCode: string;
    providerMessageId: string;
    tenantId?: string;
  }): Promise<JobItemRecord | null> {
    const row = await this.prisma.jobItem.findFirst({
      where: {
        providerCode: input.providerCode,
        providerMessageId: input.providerMessageId,
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return row ? mapItem(row) : null;
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
        sentAt: input.sentAt,
        completedAt: input.completedAt,
      },
    });
    if (updated.count === 0) {
      return this.findItemById(input.jobItemId);
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

  async listJobsNeedingFinalize(input: { limit: number }): Promise<JobRecord[]> {
    const candidates = await this.prisma.job.findMany({
      where: { status: { in: ['QUEUED', 'PROCESSING'] } },
      orderBy: { updatedAt: 'asc' },
      take: input.limit * 3,
    });

    const ready: JobRecord[] = [];
    for (const job of candidates) {
      const pending = await this.prisma.jobItem.count({
        where: {
          jobId: job.id,
          status: { in: ['QUEUED', 'RESERVED', 'SENT', 'PENDING'] },
        },
      });
      if (pending === 0 && job.itemCount > 0) {
        ready.push(mapJob(job));
      }
      if (ready.length >= input.limit) {
        break;
      }
    }
    return ready;
  }
}
