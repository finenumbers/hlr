import type {
  FinalizeJobPayload,
  JobsQueuePublisher,
  PollItemPayload,
  ReconcileStalePayload,
  SubmitBatchPayload,
} from '@finenumbers/jobs';

/**
 * Extension point for BullMQ job enqueue / processing.
 * Concrete publisher: BullMqJobsPublisher. Consumers live in apps/worker.
 */
export abstract class JobsProcessorPort implements JobsQueuePublisher {
  abstract enqueueSubmitBatch(payload: SubmitBatchPayload): Promise<void>;

  abstract enqueuePollItem(payload: PollItemPayload, delayMs?: number): Promise<void>;

  abstract enqueueFinalizeJob(payload: FinalizeJobPayload): Promise<void>;

  abstract enqueueReconciliation(payload?: ReconcileStalePayload): Promise<void>;

  /** @deprecated Use enqueuePollItem — kept for older call sites. */
  enqueuePollCheck(jobItemId: string, tenantId: string): Promise<void> {
    return this.enqueuePollItem({ jobItemId, tenantId, attempt: 1 });
  }
}

export const JOBS_PROCESSOR = Symbol('JOBS_PROCESSOR');
