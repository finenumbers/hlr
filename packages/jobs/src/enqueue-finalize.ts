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
 * Enqueue finalize with a stable BullMQ jobId so concurrent requests collapse,
 * but re-queue after a completed/failed no-op so later item-terminal events
 * (and reconciliation) are not silently dropped.
 */
export async function enqueueFinalizeJobOnQueue(
  queue: FinalizeQueueLike,
  payload: FinalizeJobPayload,
): Promise<void> {
  const jobId = finalizeBullJobId(payload.jobId);
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'completed' || state === 'failed') {
      await existing.remove();
    } else {
      // waiting | active | delayed | paused — already in flight
      return;
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
