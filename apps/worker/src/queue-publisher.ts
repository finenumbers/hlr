import {
  QUEUE_DEFAULT_JOB_OPTIONS,
  QUEUE_JOB_NAMES,
  QUEUE_NAMES,
  enqueueFinalizeJobOnQueue,
  type CsvParsePayload,
  type FinalizeJobPayload,
  type JobsQueuePublisher,
  type PollItemPayload,
  type ReconcileStalePayload,
  type SubmitBatchPayload,
} from '@finenumbers/jobs';
import { Queue } from 'bullmq';
import type IORedis from 'ioredis';

export class WorkerQueuePublisher implements JobsQueuePublisher {
  private readonly submitQueue: Queue;
  private readonly pollQueue: Queue;
  private readonly finalizeQueue: Queue;
  private readonly reconciliationQueue: Queue;
  private readonly csvParseQueue: Queue;

  constructor(connection: IORedis) {
    this.submitQueue = new Queue(QUEUE_NAMES.JOBS_SUBMIT, {
      connection,
      defaultJobOptions: QUEUE_DEFAULT_JOB_OPTIONS.submit,
    });
    this.pollQueue = new Queue(QUEUE_NAMES.JOBS_STATUS_POLL, {
      connection,
      defaultJobOptions: QUEUE_DEFAULT_JOB_OPTIONS.poll,
    });
    this.finalizeQueue = new Queue(QUEUE_NAMES.JOBS_FINALIZE, {
      connection,
      defaultJobOptions: QUEUE_DEFAULT_JOB_OPTIONS.finalize,
    });
    this.reconciliationQueue = new Queue(QUEUE_NAMES.JOBS_RECONCILIATION, {
      connection,
      defaultJobOptions: QUEUE_DEFAULT_JOB_OPTIONS.reconciliation,
    });
    this.csvParseQueue = new Queue(QUEUE_NAMES.JOBS_CSV_PARSE, {
      connection,
      defaultJobOptions: QUEUE_DEFAULT_JOB_OPTIONS.csvParse,
    });
  }

  async enqueueSubmitBatch(payload: SubmitBatchPayload): Promise<void> {
    await this.submitQueue.add(QUEUE_JOB_NAMES.SUBMIT_BATCH, payload, {
      jobId: `submit:${payload.jobId}:${payload.itemIds.length}-${simpleHash(payload.itemIds.join(','))}`,
    });
  }

  async enqueuePollItem(payload: PollItemPayload, delayMs = 0): Promise<void> {
    await this.pollQueue.add(QUEUE_JOB_NAMES.POLL_ITEM, payload, {
      delay: Math.max(0, delayMs),
      jobId: `poll:${payload.jobItemId}:${payload.attempt}`,
    });
  }

  async enqueueFinalizeJob(payload: FinalizeJobPayload): Promise<void> {
    await enqueueFinalizeJobOnQueue(this.finalizeQueue, payload);
  }

  async enqueueReconciliation(payload: ReconcileStalePayload = {}): Promise<void> {
    await this.reconciliationQueue.add(QUEUE_JOB_NAMES.RECONCILE_STALE, payload);
  }

  async enqueueCsvParse(payload: CsvParsePayload): Promise<void> {
    await this.csvParseQueue.add(QUEUE_JOB_NAMES.CSV_PARSE, payload, {
      jobId: `csv-parse:${payload.jobId}`,
    });
  }

  async close(): Promise<void> {
    await Promise.all([
      this.submitQueue.close(),
      this.pollQueue.close(),
      this.finalizeQueue.close(),
      this.reconciliationQueue.close(),
      this.csvParseQueue.close(),
    ]);
  }
}

function simpleHash(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}
