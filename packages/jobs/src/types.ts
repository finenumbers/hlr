import type { CheckType, JobItemStatus, JobSource, JobStatus } from '@finenumbers/db';
import type { NormalizedResult } from '@finenumbers/provider-core';

export type { CheckType, JobItemStatus, JobSource, JobStatus };

export type JobRecord = {
  id: string;
  tenantId: string;
  checkType: CheckType;
  source: JobSource;
  status: JobStatus;
  itemCount: number;
  successCount: number;
  failureCount: number;
  estimatedCost: string | null;
  actualCost: string | null;
  currency: string;
  originalFilename: string | null;
  idempotencyKey: string | null;
  createdByUserId: string | null;
  apiKeyId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

export type JobItemRecord = {
  id: string;
  jobId: string;
  tenantId: string;
  checkType: CheckType;
  status: JobItemStatus;
  phoneE164: string;
  providerCode: string;
  providerMessageId: string | null;
  estimatedCost: string | null;
  actualCost: string | null;
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
  normalizedResult: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  sentAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type JobProgress = {
  total: number;
  processed: number;
  success: number;
  failed: number;
  pending: number;
};

export type JobRuntimeSettings = {
  maxBatchPhones: number;
  maxCsvRows: number;
  maxCsvBytes: number;
  checkTimeoutSec: number;
  pollIntervalSec: number;
  pollMaxAttempts: number;
  submitBatchSize: number;
};

export type CsvParsePayload = {
  jobId: string;
  tenantId: string;
  filePath: string;
  requestId?: string;
};

export type CreateJobInput = {
  tenantId: string;
  checkType: CheckType;
  source: JobSource;
  /** Raw phone inputs (any common format); normalized to E.164. */
  phones: string[];
  idempotencyKey?: string | null;
  createdByUserId?: string | null;
  apiKeyId?: string | null;
  originalFilename?: string | null;
  currency?: string;
  metadata?: Record<string, unknown> | null;
  /** Optional override; otherwise loaded from platform/tenant settings. */
  runtimeSettings?: Partial<JobRuntimeSettings>;
  /** Originating HTTP request id for cross-process log correlation. */
  requestId?: string | null;
};

export type CreateJobResult = {
  job: JobRecord;
  /** True when an existing job was returned for the same idempotency key. */
  deduplicated: boolean;
  /** Phones dropped as duplicates within the request. */
  deduplicatedPhoneCount: number;
  workUnits: number;
  batchesEnqueued: number;
};

export type SubmitBatchPayload = {
  jobId: string;
  tenantId: string;
  itemIds: string[];
  /** Originating HTTP request id (propagated from create). */
  requestId?: string;
};

export type PollItemPayload = {
  jobItemId: string;
  tenantId: string;
  attempt: number;
  requestId?: string;
};

export type FinalizeJobPayload = {
  jobId: string;
  tenantId: string;
  reason?: string;
  requestId?: string;
};

export type ReconcileStalePayload = {
  /** Optional limit for how many stale items to touch per tick. */
  limit?: number;
};

export type ApplyProviderUpdateInput = {
  jobItemId?: string;
  tenantId?: string;
  providerCode?: string;
  providerMessageId?: string | null;
  normalized: NormalizedResult;
  /** Source of the update for logs/metrics. */
  source: 'callback' | 'poll' | 'submit';
};

export type ApplyProviderUpdateResult = {
  applied: boolean;
  /** True when item was already terminal — safe no-op. */
  duplicate: boolean;
  jobItem: JobItemRecord | null;
  becameTerminal: boolean;
};

export class JobsValidationError extends Error {
  readonly code = 'JOBS_VALIDATION_FAILED';
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'JobsValidationError';
    this.details = details;
  }
}

export class JobsNotFoundError extends Error {
  readonly code = 'JOBS_NOT_FOUND';

  constructor(message: string) {
    super(message);
    this.name = 'JobsNotFoundError';
  }
}

export class JobsConflictError extends Error {
  readonly code = 'JOBS_CONFLICT';

  constructor(message: string) {
    super(message);
    this.name = 'JobsConflictError';
  }
}
