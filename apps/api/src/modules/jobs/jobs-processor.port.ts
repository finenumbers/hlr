import type {
  CsvParsePayload,
  EnqueueCsvParseOptions,
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

  abstract enqueueCsvParse(
    payload: CsvParsePayload,
    options?: EnqueueCsvParseOptions,
  ): Promise<void>;
}

export const JOBS_PROCESSOR = Symbol('JOBS_PROCESSOR');
