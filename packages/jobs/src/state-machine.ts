import type { JobItemStatus, JobStatus } from '@finenumbers/db';

import { JobsConflictError } from './types.js';

const JOB_ITEM_TRANSITIONS: Record<JobItemStatus, readonly JobItemStatus[]> = {
  QUEUED: ['RESERVED', 'FAILED', 'CANCELLED'],
  /** SENT may be skipped when provider ack already implies PENDING. */
  RESERVED: ['SENT', 'PENDING', 'COMPLETED', 'FAILED', 'CANCELLED'],
  SENT: ['PENDING', 'COMPLETED', 'FAILED'],
  PENDING: ['COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

const JOB_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  QUEUED: ['PROCESSING', 'FAILED', 'CANCELLED'],
  PROCESSING: ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  COMPLETED_WITH_ERRORS: [],
  FAILED: [],
  CANCELLED: [],
};

const TERMINAL_ITEM: ReadonlySet<JobItemStatus> = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

const TERMINAL_JOB: ReadonlySet<JobStatus> = new Set([
  'COMPLETED',
  'COMPLETED_WITH_ERRORS',
  'FAILED',
  'CANCELLED',
]);

export function isTerminalJobItemStatus(status: JobItemStatus): boolean {
  return TERMINAL_ITEM.has(status);
}

export function isTerminalJobStatus(status: JobStatus): boolean {
  return TERMINAL_JOB.has(status);
}

export function canTransitionJobItem(
  from: JobItemStatus,
  to: JobItemStatus,
): boolean {
  if (from === to) {
    return true;
  }
  return JOB_ITEM_TRANSITIONS[from].includes(to);
}

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  if (from === to) {
    return true;
  }
  return JOB_TRANSITIONS[from].includes(to);
}

/**
 * Assert a forward (or identity) transition.
 * Identity is allowed for idempotent reprocessing.
 */
export function assertJobItemTransition(
  from: JobItemStatus,
  to: JobItemStatus,
): void {
  if (!canTransitionJobItem(from, to)) {
    throw new JobsConflictError(
      `Illegal JobItem transition ${from} → ${to}`,
    );
  }
}

export function assertJobTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransitionJob(from, to)) {
    throw new JobsConflictError(`Illegal Job transition ${from} → ${to}`);
  }
}

/**
 * Map provider lifecycle into the next JobItem status.
 * Non-terminal provider states keep the item in PENDING (or SENT→PENDING).
 */
export function mapProviderLifecycleToItemStatus(
  lifecycleStatus: 'accepted' | 'pending' | 'completed' | 'failed',
  current: JobItemStatus,
): JobItemStatus | null {
  switch (lifecycleStatus) {
    case 'accepted':
    case 'pending':
      if (current === 'SENT' || current === 'RESERVED' || current === 'QUEUED') {
        return 'PENDING';
      }
      if (current === 'PENDING') {
        return 'PENDING';
      }
      return null;
    case 'completed':
      return 'COMPLETED';
    case 'failed':
      return 'FAILED';
    default:
      return null;
  }
}

/** Derive terminal Job status from item outcome counters. */
export function deriveJobTerminalStatus(progress: {
  total: number;
  success: number;
  failed: number;
}): JobStatus {
  const { total, success, failed } = progress;
  if (total === 0) {
    return 'FAILED';
  }
  if (failed === 0 && success === total) {
    return 'COMPLETED';
  }
  if (success === 0 && failed === total) {
    return 'FAILED';
  }
  return 'COMPLETED_WITH_ERRORS';
}

export function computeProgress(input: {
  itemCount: number;
  successCount: number;
  failureCount: number;
}): {
  total: number;
  processed: number;
  success: number;
  failed: number;
  pending: number;
} {
  const processed = input.successCount + input.failureCount;
  return {
    total: input.itemCount,
    processed,
    success: input.successCount,
    failed: input.failureCount,
    pending: Math.max(0, input.itemCount - processed),
  };
}
