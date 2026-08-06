import { randomUUID } from 'node:crypto';

import { DEFAULT_JOB_RUNTIME_SETTINGS } from './queue-names.js';
import {
  assertJobItemTransition,
  assertJobTransition,
  computeProgress,
  isTerminalJobItemStatus,
} from './state-machine.js';
import type { JobsStore } from './ports.js';
import type {
  CreateJobInput,
  JobItemRecord,
  JobRecord,
  JobRuntimeSettings,
} from './types.js';

function cloneJob(job: JobRecord): JobRecord {
  return { ...job, metadata: job.metadata ? { ...job.metadata } : null };
}

function cloneItem(item: JobItemRecord): JobItemRecord {
  return {
    ...item,
    normalizedResult: item.normalizedResult ? { ...item.normalizedResult } : null,
  };
}

/** In-memory JobsStore for unit tests. */
export class InMemoryJobsStore implements JobsStore {
  readonly jobs = new Map<string, JobRecord>();
  readonly items = new Map<string, JobItemRecord>();
  settings: JobRuntimeSettings = { ...DEFAULT_JOB_RUNTIME_SETTINGS };

  async getRuntimeSettings(): Promise<JobRuntimeSettings> {
    return { ...this.settings };
  }

  async findJobByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<JobRecord | null> {
    for (const job of this.jobs.values()) {
      if (job.tenantId === tenantId && job.idempotencyKey === idempotencyKey) {
        return cloneJob(job);
      }
    }
    return null;
  }

  async findJobById(jobId: string): Promise<JobRecord | null> {
    const job = this.jobs.get(jobId);
    return job ? cloneJob(job) : null;
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
    // Mirror Postgres @@unique([tenantId, idempotencyKey]) for race-path tests.
    if (input.idempotencyKey) {
      for (const existing of this.jobs.values()) {
        if (
          existing.tenantId === input.tenantId &&
          existing.idempotencyKey === input.idempotencyKey
        ) {
          throw Object.assign(new Error('Unique constraint failed on tenantId_idempotencyKey'), {
            code: 'P2002',
          });
        }
      }
    }

    const snap = input.priceSnapshot ?? null;
    const now = new Date();
    const job: JobRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      checkType: input.checkType,
      source: input.source,
      status: 'QUEUED',
      itemCount: input.phones.length,
      successCount: 0,
      failureCount: 0,
      estimatedCost:
        snap && input.phones.length > 0
          ? String(Number(snap.unitSellPrice) * input.phones.length)
          : null,
      actualCost: null,
      currency: input.currency,
      unitSellPrice: snap?.unitSellPrice ?? null,
      unitProviderCost: snap?.unitProviderCost ?? null,
      tariffPlanId: snap?.tariffPlanId ?? null,
      tariffPlanCode: snap?.tariffPlanCode ?? null,
      originalFilename: input.originalFilename,
      idempotencyKey: input.idempotencyKey,
      createdByUserId: input.createdByUserId,
      apiKeyId: input.apiKeyId,
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);

    const items: JobItemRecord[] = input.phones.map((phoneE164) => {
      const item: JobItemRecord = {
        id: randomUUID(),
        jobId: job.id,
        tenantId: input.tenantId,
        checkType: input.checkType,
        status: 'QUEUED',
        phoneE164,
        providerCode: 'smsc',
        providerMessageId: null,
        estimatedCost: snap?.unitSellPrice ?? null,
        actualCost: null,
        currency: input.currency,
        unitSellPrice: snap?.unitSellPrice ?? null,
        unitProviderCost: snap?.unitProviderCost ?? null,
        tariffPlanId: snap?.tariffPlanId ?? null,
        tariffPlanCode: snap?.tariffPlanCode ?? null,
        resultStatus: null,
        isReachable: null,
        imsi: null,
        mcc: null,
        mnc: null,
        operatorName: null,
        countryCode: null,
        ported: null,
        roaming: null,
        normalizedResult: null,
        errorCode: null,
        errorMessage: null,
        sentAt: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      this.items.set(item.id, item);
      return cloneItem(item);
    });

    return { job: cloneJob(job), items };
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
    if (
      !input.priceSnapshot?.unitSellPrice ||
      !input.priceSnapshot.unitProviderCost ||
      !input.priceSnapshot.tariffPlanId ||
      !input.priceSnapshot.tariffPlanCode
    ) {
      throw new Error(
        'createJobShell requires a full priceSnapshot (unitSellPrice, unitProviderCost, tariffPlanId, tariffPlanCode)',
      );
    }
    const result = await this.createJobWithItems({ ...input, phones: [] });
    return result.job;
  }

  async attachItemsToJob(input: {
    jobId: string;
    tenantId: string;
    checkType: JobRecord['checkType'];
    phones: string[];
    currency: string;
  }): Promise<{ job: JobRecord; items: JobItemRecord[] }> {
    const job = this.jobs.get(input.jobId);
    if (!job) {
      throw new Error(`Job ${input.jobId} not found`);
    }
    const now = new Date();
    const items: JobItemRecord[] = input.phones.map((phoneE164) => {
      const item: JobItemRecord = {
        id: randomUUID(),
        jobId: job.id,
        tenantId: input.tenantId,
        checkType: input.checkType,
        status: 'QUEUED',
        phoneE164,
        providerCode: 'smsc',
        providerMessageId: null,
        estimatedCost: job.unitSellPrice,
        actualCost: null,
        currency: input.currency,
        unitSellPrice: job.unitSellPrice,
        unitProviderCost: job.unitProviderCost,
        tariffPlanId: job.tariffPlanId,
        tariffPlanCode: job.tariffPlanCode,
        resultStatus: null,
        isReachable: null,
        imsi: null,
        mcc: null,
        mnc: null,
        operatorName: null,
        countryCode: null,
        ported: null,
        roaming: null,
        normalizedResult: null,
        errorCode: null,
        errorMessage: null,
        sentAt: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      this.items.set(item.id, item);
      return cloneItem(item);
    });
    job.itemCount = input.phones.length;
    job.estimatedCost =
      job.unitSellPrice !== null
        ? String(Number(job.unitSellPrice) * input.phones.length)
        : job.estimatedCost;
    job.metadata = {
      ...(job.metadata ?? {}),
      csvPending: false,
      csvAttachedAt: now.toISOString(),
    };
    job.updatedAt = now;
    this.jobs.set(job.id, job);
    return { job: cloneJob(job), items };
  }

  async patchJobMetadata(
    jobId: string,
    patch: Record<string, unknown>,
  ): Promise<JobRecord | null> {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    job.metadata = { ...(job.metadata ?? {}), ...patch };
    job.updatedAt = new Date();
    this.jobs.set(jobId, job);
    return cloneJob(job);
  }

  async listItemsByIds(itemIds: string[]): Promise<JobItemRecord[]> {
    return itemIds
      .map((id) => this.items.get(id))
      .filter((item): item is JobItemRecord => Boolean(item))
      .map(cloneItem);
  }

  async listItemsByJobId(jobId: string): Promise<JobItemRecord[]> {
    return [...this.items.values()]
      .filter((item) => item.jobId === jobId)
      .map(cloneItem);
  }

  async listQueuedItemIdsByJobId(jobId: string): Promise<string[]> {
    return [...this.items.values()]
      .filter((item) => item.jobId === jobId && item.status === 'QUEUED')
      .map((item) => item.id)
      .sort();
  }

  async findItemById(jobItemId: string): Promise<JobItemRecord | null> {
    const item = this.items.get(jobItemId);
    return item ? cloneItem(item) : null;
  }

  async findItemByProviderMessageId(input: {
    providerCode: string;
    providerMessageId: string;
    tenantId?: string;
  }): Promise<JobItemRecord | null> {
    for (const item of this.items.values()) {
      if (
        item.providerCode === input.providerCode &&
        item.providerMessageId === input.providerMessageId &&
        (!input.tenantId || item.tenantId === input.tenantId)
      ) {
        return cloneItem(item);
      }
    }
    return null;
  }

  async claimItemForSubmit(jobItemId: string): Promise<JobItemRecord | null> {
    const item = this.items.get(jobItemId);
    if (!item) {
      return null;
    }
    if (item.status === 'RESERVED') {
      return cloneItem(item);
    }
    if (item.status !== 'QUEUED') {
      return null;
    }
    assertJobItemTransition(item.status, 'RESERVED');
    item.status = 'RESERVED';
    item.updatedAt = new Date();
    return cloneItem(item);
  }

  async markJobProcessing(jobId: string): Promise<JobRecord | null> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }
    if (job.status === 'PROCESSING') {
      return cloneJob(job);
    }
    if (job.status !== 'QUEUED') {
      return cloneJob(job);
    }
    assertJobTransition(job.status, 'PROCESSING');
    job.status = 'PROCESSING';
    job.startedAt = job.startedAt ?? new Date();
    job.updatedAt = new Date();
    return cloneJob(job);
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
    const item = this.items.get(input.jobItemId);
    if (!item) {
      return null;
    }
    if (item.status !== 'RESERVED' && item.status !== 'SENT') {
      if (isTerminalJobItemStatus(item.status)) {
        return cloneItem(item);
      }
      return null;
    }
    assertJobItemTransition(item.status, input.status);
    item.status = input.status;
    item.providerMessageId = input.providerMessageId;
    item.providerCode = input.providerCode;
    if (input.normalizedResult !== undefined) {
      item.normalizedResult = input.normalizedResult;
    }
    if (input.resultStatus !== undefined) item.resultStatus = input.resultStatus;
    if (input.isReachable !== undefined) item.isReachable = input.isReachable;
    if (input.imsi !== undefined) item.imsi = input.imsi;
    if (input.mcc !== undefined) item.mcc = input.mcc;
    if (input.mnc !== undefined) item.mnc = input.mnc;
    if (input.operatorName !== undefined) item.operatorName = input.operatorName;
    if (input.countryCode !== undefined) item.countryCode = input.countryCode;
    if (input.ported !== undefined) item.ported = input.ported;
    if (input.roaming !== undefined) item.roaming = input.roaming;
    if (input.actualCost !== undefined) item.actualCost = input.actualCost;
    if (input.errorCode !== undefined) item.errorCode = input.errorCode;
    if (input.errorMessage !== undefined) item.errorMessage = input.errorMessage;
    if (input.sentAt !== undefined) item.sentAt = input.sentAt;
    if (input.completedAt !== undefined) item.completedAt = input.completedAt;
    item.updatedAt = new Date();
    return cloneItem(item);
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
    const item = this.items.get(input.jobItemId);
    if (!item) {
      return null;
    }
    if (!input.fromStatuses.includes(item.status)) {
      return null;
    }
    assertJobItemTransition(item.status, input.toStatus);
    item.status = input.toStatus;
    Object.assign(item, input.patch);
    item.updatedAt = new Date();
    return cloneItem(item);
  }

  async refreshJobCounters(jobId: string): Promise<JobRecord> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }
    const items = [...this.items.values()].filter((i) => i.jobId === jobId);
    job.itemCount = items.length;
    job.successCount = items.filter((i) => i.status === 'COMPLETED').length;
    job.failureCount = items.filter(
      (i) => i.status === 'FAILED' || i.status === 'CANCELLED',
    ).length;
    job.updatedAt = new Date();
    return cloneJob(job);
  }

  async finalizeJob(input: {
    jobId: string;
    status: JobRecord['status'];
    errorCode?: string | null;
    errorMessage?: string | null;
  }): Promise<JobRecord | null> {
    const job = this.jobs.get(input.jobId);
    if (!job) {
      return null;
    }
    const terminal = new Set([
      'COMPLETED',
      'COMPLETED_WITH_ERRORS',
      'FAILED',
      'CANCELLED',
    ]);
    if (terminal.has(job.status)) {
      return cloneJob(job);
    }
    assertJobTransition(job.status, input.status);
    job.status = input.status;
    job.errorCode = input.errorCode ?? null;
    job.errorMessage = input.errorMessage ?? null;
    job.completedAt = new Date();
    job.updatedAt = new Date();
    return cloneJob(job);
  }

  async listStalePendingItems(input: {
    olderThan: Date;
    limit: number;
  }): Promise<JobItemRecord[]> {
    return [...this.items.values()]
      .filter(
        (item) =>
          (item.status === 'PENDING' || item.status === 'SENT') &&
          (item.updatedAt < input.olderThan ||
            (item.sentAt !== null && item.sentAt < input.olderThan)),
      )
      .slice(0, input.limit)
      .map(cloneItem);
  }

  async listJobsNeedingFinalize(input: { limit: number }): Promise<JobRecord[]> {
    const result: JobRecord[] = [];
    for (const job of this.jobs.values()) {
      if (job.status !== 'PROCESSING' && job.status !== 'QUEUED') {
        continue;
      }
      const progress = computeProgress(job);
      if (progress.pending === 0 && progress.total > 0) {
        result.push(cloneJob(job));
      }
      if (result.length >= input.limit) {
        break;
      }
    }
    return result;
  }

  async listJobsNeedingSubmitResume(input: {
    olderThan: Date;
    limit: number;
  }): Promise<JobRecord[]> {
    const result: JobRecord[] = [];
    for (const job of this.jobs.values()) {
      if (job.status !== 'PROCESSING' && job.status !== 'QUEUED') {
        continue;
      }
      if (job.itemCount <= 0) continue;
      const hasStranded = [...this.items.values()].some(
        (item) =>
          item.jobId === job.id &&
          item.status === 'QUEUED' &&
          item.updatedAt < input.olderThan,
      );
      if (hasStranded) {
        result.push(cloneJob(job));
      }
      if (result.length >= input.limit) break;
    }
    return result;
  }

  async listEmptyCsvShellsNeedingHeal(input: {
    olderThan: Date;
    limit: number;
  }): Promise<JobRecord[]> {
    const result: JobRecord[] = [];
    for (const job of this.jobs.values()) {
      if (job.status !== 'PROCESSING' && job.status !== 'QUEUED') continue;
      if (job.itemCount !== 0) continue;
      if (job.metadata?.csvPending !== true) continue;
      if (job.updatedAt >= input.olderThan) continue;
      result.push(cloneJob(job));
      if (result.length >= input.limit) break;
    }
    return result;
  }
}
