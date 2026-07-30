import { QUEUE_JOB_NAMES } from './queue-names.js';
import type { FinalizeJobPayload } from './types.js';

/** Minimal BullMQ Queue surface used by finalize enqueue helpers. */
export type FinalizeQueueLike = {
  getJob(
    jobId: string,
  ): Promise<{
    getState(): Promise<string>;
    remove(): Promise<void>;
  } | null | undefined>;
  add(
    name: string,
    data: FinalizeJobPayload,
    opts: { jobId: string },
  ): Promise<unknown>;
};

export function finalizeBullJobId(jobId: string): string {
  return `finalize:${jobId}`;
}

function isDuplicateJobIdError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const message = 'message' in err ? String((err as { message: unknown }).message) : '';
  return /already exists/i.test(message);
}

/**
 * Enqueue finalize with a stable BullMQ jobId so concurrent in-flight work collapses.
 * Only skip when a finalize is currently **active**; waiting/delayed/completed leftovers
 * are removed so reconciliation can heal stuck PROCESSING jobs.
 */
export async function enqueueFinalizeJobOnQueue(
  queue: FinalizeQueueLike,
  payload: FinalizeJobPayload,
): Promise<void> {
  const jobId = finalizeBullJobId(payload.jobId);
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'active') {
      return;
    }
    try {
      await existing.remove();
    } catch {
      // Locked/raced job — fall through and treat duplicate add as success.
    }
  }

  try {
    await queue.add(QUEUE_JOB_NAMES.FINALIZE_JOB, payload, { jobId });
  } catch (err) {
    if (isDuplicateJobIdError(err)) {
      return;
    }
    throw err;
  }
}
