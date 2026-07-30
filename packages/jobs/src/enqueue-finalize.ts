import { QUEUE_JOB_NAMES } from './queue-names.js';
import type { FinalizeJobPayload } from './types.js';

/** Delay before a follow-up finalize when one is already active (closes last-item race). */
export const FINALIZE_ACTIVE_FOLLOWUP_DELAY_MS = 2_500;

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
    opts: { jobId: string; delay?: number },
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
 * Only skip the stable id when a finalize is currently **active**; in that case schedule a
 * delayed follow-up with a unique jobId so the last item's terminal event is not dropped.
 * Waiting/delayed/completed leftovers are removed so reconciliation can heal stuck jobs.
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
      await queue.add(QUEUE_JOB_NAMES.FINALIZE_JOB, payload, {
        jobId: `finalize:${payload.jobId}:d:${Date.now()}`,
        delay: FINALIZE_ACTIVE_FOLLOWUP_DELAY_MS,
      });
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
