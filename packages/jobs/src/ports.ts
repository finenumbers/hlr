import type { NumberLookupProvider } from '@finenumbers/provider-core';

import type {
  ApplyProviderUpdateInput,
  ApplyProviderUpdateResult,
  CreateJobInput,
  CreateJobResult,
  CsvParsePayload,
  FinalizeJobPayload,
  JobItemBillingAction,
  JobItemRecord,
  JobRecord,
  JobRuntimeSettings,
  PollItemPayload,
  ReconcileStalePayload,
  SubmitBatchPayload,
  SubmitDlqHealPayload,
} from './types.js';

export type JobsLogger = {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
};

/**
 * Persistence boundary for the jobs subsystem.
 * Implementations: Prisma (prod), in-memory (tests).
 */
export interface JobsStore {
  getRuntimeSettings(tenantId: string): Promise<JobRuntimeSettings>;

  findJobByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<JobRecord | null>;

  findJobById(jobId: string): Promise<JobRecord | null>;

  createJobWithItems(input: {
    tenantId: string;
    checkType: CreateJobInput['checkType'];
    source: CreateJobInput['source'];
    phones: string[];
    idempotencyKey: string | null;
    createdByUserId: string | null;
    apiKeyId: string | null;
    originalFilename: string | null;
    currency: string;
    priceSnapshot?: CreateJobInput['priceSnapshot'];
    metadata: Record<string, unknown> | null;
  }): Promise<{ job: JobRecord; items: JobItemRecord[] }>;

  /** Create job shell for async CSV parse (itemCount=0 until parse completes). */
  createJobShell(input: {
    tenantId: string;
    checkType: CreateJobInput['checkType'];
    source: CreateJobInput['source'];
    idempotencyKey: string | null;
    createdByUserId: string | null;
    apiKeyId: string | null;
    originalFilename: string | null;
    currency: string;
    priceSnapshot?: CreateJobInput['priceSnapshot'];
    metadata: Record<string, unknown> | null;
  }): Promise<JobRecord>;

  /** Attach parsed phones as JobItems and set itemCount. */
  attachItemsToJob(input: {
    jobId: string;
    tenantId: string;
    checkType: CreateJobInput['checkType'];
    phones: string[];
    currency: string;
  }): Promise<{ job: JobRecord; items: JobItemRecord[] }>;

  /** Shallow-merge job.metadata keys (used to clear csvPending, track DLQ cycles). */
  patchJobMetadata(
    jobId: string,
    patch: Record<string, unknown>,
  ): Promise<JobRecord | null>;

  /**
   * Hard-delete a job and its items (submit rollback when enqueue fails).
   * No-op if the job is already gone.
   */
  deleteJobCascade(jobId: string): Promise<void>;

  listItemsByIds(itemIds: string[]): Promise<JobItemRecord[]>;

  listItemsByJobId(jobId: string): Promise<JobItemRecord[]>;

  /** Item ids still QUEUED for a job (ordered for stable resume batching). */
  listQueuedItemIdsByJobId(jobId: string): Promise<string[]>;

  findItemById(jobItemId: string): Promise<JobItemRecord | null>;

  findItemByProviderMessageId(input: {
    providerCode: string;
    providerMessageId: string;
    tenantId?: string;
    /** When set, require exact phone match (SMSC callback). */
    phoneE164?: string | null;
  }): Promise<JobItemRecord | null>;

  /**
   * Conditional claim: QUEUED → RESERVED. Returns null if already claimed/terminal.
   */
  claimItemForSubmit(jobItemId: string): Promise<JobItemRecord | null>;

  /**
   * Mark job PROCESSING if still QUEUED (idempotent).
   */
  markJobProcessing(jobId: string): Promise<JobRecord | null>;

  updateItemAfterSubmit(input: {
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
    billingAction?: JobItemBillingAction | null;
    sentAt?: Date | null;
    completedAt?: Date | null;
  }): Promise<JobItemRecord | null>;

  /**
   * Apply a status update only when transition is legal.
   * Returns null when item missing or transition rejected (already terminal).
   */
  transitionItem(input: {
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
      billingAction: JobItemBillingAction | null;
      sentAt: Date | null;
      completedAt: Date | null;
    }>;
  }): Promise<JobItemRecord | null>;

  /**
   * Recalculate success/failure counters from items and optionally set terminal status.
   */
  refreshJobCounters(jobId: string): Promise<JobRecord>;

  finalizeJob(input: {
    jobId: string;
    status: JobRecord['status'];
    errorCode?: string | null;
    errorMessage?: string | null;
  }): Promise<JobRecord | null>;

  listStalePendingItems(input: {
    olderThan: Date;
    limit: number;
  }): Promise<JobItemRecord[]>;

  /** RESERVED items older than threshold (lost submit / DLQ gap). */
  listStaleReservedItems(input: {
    olderThan: Date;
    limit: number;
  }): Promise<JobItemRecord[]>;

  listJobsNeedingFinalize(input: {
    limit: number;
  }): Promise<JobRecord[]>;

  /**
   * Jobs with stranded QUEUED items (fan-out lost after attach / crash).
   * Used by reconciliation to re-enqueue submit batches.
   */
  listJobsNeedingSubmitResume(input: {
    olderThan: Date;
    limit: number;
  }): Promise<JobRecord[]>;

  /**
   * CSV shells stuck with itemCount=0 and metadata.csvPending (parse never attached).
   */
  listEmptyCsvShellsNeedingHeal(input: {
    olderThan: Date;
    limit: number;
  }): Promise<JobRecord[]>;
}

/**
 * Queue publisher used by API (create) and workers (schedule poll/finalize).
 */
export type EnqueueCsvParseOptions = {
  /** Remove retained Bull job with the same csv-parse jobId before add (heal path). */
  replaceExisting?: boolean;
};

export interface JobsQueuePublisher {
  enqueueSubmitBatch(payload: SubmitBatchPayload): Promise<void>;
  /** Durable retries for markSubmitBatchDeadLetter after submit attempts exhausted. */
  enqueueSubmitDlqHeal(payload: SubmitDlqHealPayload): Promise<void>;
  enqueuePollItem(payload: PollItemPayload, delayMs?: number): Promise<void>;
  enqueueFinalizeJob(payload: FinalizeJobPayload): Promise<void>;
  enqueueReconciliation(payload?: ReconcileStalePayload): Promise<void>;
  enqueueCsvParse(
    payload: CsvParsePayload,
    options?: EnqueueCsvParseOptions,
  ): Promise<void>;
}

/**
 * Extension point for E07 billing. Default: no-op with structured logs.
 */
export interface JobsBillingHooks {
  onItemReserved(input: {
    tenantId: string;
    jobItemId: string;
    checkType: JobItemRecord['checkType'];
  }): Promise<void>;

  onItemTerminal(input: {
    tenantId: string;
    jobItemId: string;
    status: 'COMPLETED' | 'FAILED';
    /** Provider reached a final result (capture) vs send/timeout failure (release). */
    billingAction: 'capture' | 'release';
  }): Promise<void>;

  onJobFinalized(input: {
    tenantId: string;
    jobId: string;
    status: JobRecord['status'];
  }): Promise<void>;

  /** Optional: settle stranded open HOLDs on terminal jobs (reconcile reaper). */
  reapOpenHolds?(input: { limit: number }): Promise<{
    jobCount: number;
    captured: number;
    released: number;
  }>;
}

/**
 * Extension point for E13 webhook delivery. Default: no-op.
 */
export interface JobsWebhookHooks {
  onItemTerminal(input: {
    tenantId: string;
    jobItemId: string;
    jobId: string;
    status: 'COMPLETED' | 'FAILED';
  }): Promise<void>;

  onJobFinalized(input: {
    tenantId: string;
    jobId: string;
    status: JobRecord['status'];
  }): Promise<void>;
}

export type JobsProviderPort = Pick<
  NumberLookupProvider,
  'submitHlr' | 'submitPing' | 'fetchStatus'
>;

export type CreateJobServiceDeps = {
  store: JobsStore;
  queue: JobsQueuePublisher;
  logger?: JobsLogger;
  /**
   * Full-batch affordability using the job's frozen unitSellPrice (CSV after parse).
   * Must gate product still assigned; must NOT re-price from live catalog.
   */
  assertCanAffordFrozen?: (input: {
    tenantId: string;
    checkType: 'HLR' | 'PING';
    unitCount: number;
    unitSellPrice: string;
  }) => Promise<void>;
};

export type JobLifecycleServiceDeps = {
  store: JobsStore;
  queue: JobsQueuePublisher;
  provider: JobsProviderPort;
  billing?: JobsBillingHooks;
  webhooks?: JobsWebhookHooks;
  logger?: JobsLogger;
  now?: () => Date;
};

export type CreateJobFn = (input: CreateJobInput) => Promise<CreateJobResult>;
export type ApplyProviderUpdateFn = (
  input: ApplyProviderUpdateInput,
) => Promise<ApplyProviderUpdateResult>;
