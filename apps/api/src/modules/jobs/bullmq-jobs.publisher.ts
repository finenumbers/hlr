import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
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
import IORedis from 'ioredis';

import { AppConfigService } from '../../common/config/app-config.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { JobsProcessorPort } from './jobs-processor.port';

/**
 * BullMQ producer used by the API process.
 * Workers consume the same queue names in apps/worker.
 */
@Injectable()
export class BullMqJobsPublisher
  extends JobsProcessorPort
  implements JobsQueuePublisher, OnModuleInit, OnModuleDestroy
{
  private connection: IORedis | null = null;
  private submitQueue: Queue | null = null;
  private pollQueue: Queue | null = null;
  private finalizeQueue: Queue | null = null;
  private reconciliationQueue: Queue | null = null;
  private csvParseQueue: Queue | null = null;

  constructor(
    private readonly config: AppConfigService,
    private readonly logger: AppLogger,
  ) {
    super();
  }

  onModuleInit(): void {
    this.connection = new IORedis(this.config.redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    this.submitQueue = new Queue(QUEUE_NAMES.JOBS_SUBMIT, {
      connection: this.connection,
      defaultJobOptions: QUEUE_DEFAULT_JOB_OPTIONS.submit,
    });
    this.pollQueue = new Queue(QUEUE_NAMES.JOBS_STATUS_POLL, {
      connection: this.connection,
      defaultJobOptions: QUEUE_DEFAULT_JOB_OPTIONS.poll,
    });
    this.finalizeQueue = new Queue(QUEUE_NAMES.JOBS_FINALIZE, {
      connection: this.connection,
      defaultJobOptions: QUEUE_DEFAULT_JOB_OPTIONS.finalize,
    });
    this.reconciliationQueue = new Queue(QUEUE_NAMES.JOBS_RECONCILIATION, {
      connection: this.connection,
      defaultJobOptions: QUEUE_DEFAULT_JOB_OPTIONS.reconciliation,
    });
    this.csvParseQueue = new Queue(QUEUE_NAMES.JOBS_CSV_PARSE, {
      connection: this.connection,
      defaultJobOptions: QUEUE_DEFAULT_JOB_OPTIONS.csvParse,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([
      this.submitQueue?.close(),
      this.pollQueue?.close(),
      this.finalizeQueue?.close(),
      this.reconciliationQueue?.close(),
      this.csvParseQueue?.close(),
    ]);
    if (this.connection && this.connection.status !== 'end') {
      await this.connection.quit();
    }
  }

  async enqueueSubmitBatch(payload: SubmitBatchPayload): Promise<void> {
    const queue = this.requireQueue(this.submitQueue, QUEUE_NAMES.JOBS_SUBMIT);
    try {
      await queue.add(QUEUE_JOB_NAMES.SUBMIT_BATCH, payload, {
        jobId: `submit:${payload.jobId}:${hashIds(payload.itemIds)}`,
      });
    } catch (error) {
      if (isDuplicateJobIdError(error)) {
        this.logger.log(
          {
            message: 'jobs.queue.enqueue_submit_duplicate',
            jobId: payload.jobId,
            tenantId: payload.tenantId,
            itemCount: payload.itemIds.length,
          },
          'JobsQueue',
        );
        return;
      }
      throw error;
    }
    this.logger.log(
      {
        message: 'jobs.queue.enqueue_submit',
        jobId: payload.jobId,
        tenantId: payload.tenantId,
        itemCount: payload.itemIds.length,
      },
      'JobsQueue',
    );
  }

  async enqueuePollItem(payload: PollItemPayload, delayMs = 0): Promise<void> {
    const queue = this.requireQueue(this.pollQueue, QUEUE_NAMES.JOBS_STATUS_POLL);
    await queue.add(QUEUE_JOB_NAMES.POLL_ITEM, payload, {
      delay: Math.max(0, delayMs),
      // Unique per attempt so delayed retries are not deduped away.
      jobId: `poll:${payload.jobItemId}:${payload.attempt}`,
    });
  }

  async enqueueFinalizeJob(payload: FinalizeJobPayload): Promise<void> {
    const queue = this.requireQueue(
      this.finalizeQueue,
      QUEUE_NAMES.JOBS_FINALIZE,
    );
    await enqueueFinalizeJobOnQueue(queue, payload);
  }

  async enqueueReconciliation(payload: ReconcileStalePayload = {}): Promise<void> {
    const queue = this.requireQueue(
      this.reconciliationQueue,
      QUEUE_NAMES.JOBS_RECONCILIATION,
    );
    await queue.add(QUEUE_JOB_NAMES.RECONCILE_STALE, payload);
  }

  async enqueueCsvParse(payload: CsvParsePayload): Promise<void> {
    const queue = this.requireQueue(this.csvParseQueue, QUEUE_NAMES.JOBS_CSV_PARSE);
    await queue.add(QUEUE_JOB_NAMES.CSV_PARSE, payload, {
      jobId: `csv-parse:${payload.jobId}`,
    });
    this.logger.log(
      {
        message: 'jobs.queue.enqueue_csv_parse',
        jobId: payload.jobId,
        tenantId: payload.tenantId,
      },
      'JobsQueue',
    );
  }

  private requireQueue<T>(queue: Queue<T> | null, name: string): Queue<T> {
    if (!queue) {
      throw new Error(`BullMQ queue ${name} is not initialized`);
    }
    return queue;
  }
}

function hashIds(ids: string[]): string {
  // Short stable fingerprint for BullMQ jobId (avoid huge keys).
  let hash = 0;
  const joined = ids.join(',');
  for (let i = 0; i < joined.length; i += 1) {
    hash = (hash * 31 + joined.charCodeAt(i)) >>> 0;
  }
  return `${ids.length}-${hash.toString(16)}`;
}

function isDuplicateJobIdError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already exists/i.test(message);
}
