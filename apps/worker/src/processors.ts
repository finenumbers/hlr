import {
  CsvParseService,
  QUEUE_JOB_NAMES,
  QUEUE_NAMES,
  type CsvParsePayload,
  type FinalizeJobPayload,
  type JobLifecycleService,
  type JobsQueuePublisher,
  type JobsStore,
  type PollItemPayload,
  type ReconcileStalePayload,
  type SubmitBatchPayload,
} from '@finenumbers/jobs';
import { isProviderError } from '@finenumbers/provider-core';
import type { Job, Worker } from 'bullmq';
import { UnrecoverableError, Worker as BullWorker } from 'bullmq';
import type IORedis from 'ioredis';

import { workerLogger } from './logger';
import { observeWorkerJob, type WorkerMetrics } from './metrics';

export type JobsWorkers = {
  submit: Worker;
  poll: Worker;
  finalize: Worker;
  reconciliation: Worker;
  retention: Worker;
  csvParse: Worker;
};

export function createJobsWorkers(input: {
  connection: IORedis;
  concurrency: number;
  lifecycle: JobLifecycleService;
  store: JobsStore;
  queue: JobsQueuePublisher;
  metrics?: WorkerMetrics;
  onRetention?: () => Promise<unknown>;
  /**
   * Required: full CSV affordability using frozen job.unitSellPrice × count
   * (plus live product-assignment gate).
   */
  assertCanAffordFrozen: (input: {
    tenantId: string;
    checkType: 'HLR' | 'PING';
    unitCount: number;
    unitSellPrice: string;
  }) => Promise<void>;
}): JobsWorkers {
  const {
    connection,
    concurrency,
    lifecycle,
    store,
    queue,
    metrics,
    onRetention,
    assertCanAffordFrozen,
  } = input;
  const csvParseService = new CsvParseService({
    store,
    queue,
    logger: workerLogger,
    assertCanAffordFrozen,
  });

  const submit = new BullWorker(
    QUEUE_NAMES.JOBS_SUBMIT,
    async (job: Job<SubmitBatchPayload & { reason?: string }>) => {
      if (job.name === QUEUE_JOB_NAMES.SUBMIT_DLQ_HEAL) {
        const started = process.hrtime.bigint();
        workerLogger.warn('jobs.worker.submit.dlq_heal.start', {
          bullJobId: job.id,
          jobId: job.data.jobId,
          tenantId: job.data.tenantId,
          reason: job.data.reason,
        });
        try {
          await lifecycle.markSubmitBatchDeadLetter(
            job.data,
            job.data.reason ?? 'submit dead-letter',
          );
          observeWorkerJob(metrics, {
            queue: QUEUE_NAMES.JOBS_SUBMIT,
            status: 'completed',
            started,
          });
          return { healed: true };
        } catch (error) {
          observeWorkerJob(metrics, {
            queue: QUEUE_NAMES.JOBS_SUBMIT,
            status: 'failed',
            started,
          });
          throw error;
        }
      }
      if (job.name !== QUEUE_JOB_NAMES.SUBMIT_BATCH) {
        throw new UnrecoverableError(`Unknown job name ${job.name}`);
      }
      const started = process.hrtime.bigint();
      workerLogger.info('jobs.worker.submit.start', {
        bullJobId: job.id,
        jobId: job.data.jobId,
        tenantId: job.data.tenantId,
        ...(job.data.requestId ? { requestId: job.data.requestId } : {}),
      });
      try {
        const result = await lifecycle.processSubmitBatch(job.data);
        // Non-retryable provider/item failures are absorbed inside the batch and
        // still complete the BullMQ job — count them here so metrics stay useful.
        if (result.failed > 0) {
          metrics?.providerErrorsTotal.inc(
            { provider: 'smsc', kind: 'submit_item', stage: 'submit' },
            result.failed,
          );
        }
        observeWorkerJob(metrics, {
          queue: QUEUE_NAMES.JOBS_SUBMIT,
          status: 'completed',
          started,
        });
        return result;
      } catch (error) {
        observeWorkerJob(metrics, {
          queue: QUEUE_NAMES.JOBS_SUBMIT,
          status: 'failed',
          started,
        });
        recordProviderThrow(metrics, error, 'submit');
        // Await heal on last attempt inside the processor (Bull EventEmitter
        // listeners are not awaited — do not rely on submit.on('failed')).
        if (job.name === QUEUE_JOB_NAMES.SUBMIT_BATCH) {
          const maxAttempts = job.opts.attempts ?? 1;
          if (job.attemptsMade + 1 >= maxAttempts) {
            const reason = error instanceof Error ? error.message : String(error);
            try {
              await queue.enqueueSubmitDlqHeal({
                ...job.data,
                reason,
              });
            } catch (deadLetterError: unknown) {
              workerLogger.error('jobs.worker.submit.dead_letter_enqueue_failed', {
                message:
                  deadLetterError instanceof Error
                    ? deadLetterError.message
                    : String(deadLetterError),
              });
            }
          }
        }
        throw error;
      }
    },
    // lockDuration 5m: slow SMSC must not stall (~30s default) into double-claim.
    { connection, concurrency, lockDuration: 300_000 },
  );

  submit.on('failed', (job, error) => {
    workerLogger.error('jobs.worker.submit.failed', {
      bullJobId: job?.id,
      jobId: job?.data?.jobId,
      tenantId: job?.data?.tenantId,
      jobName: job?.name,
      attemptsMade: job?.attemptsMade,
      message: error.message,
      ...(job?.data?.requestId ? { requestId: job.data.requestId } : {}),
    });
  });

  const poll = new BullWorker(
    QUEUE_NAMES.JOBS_STATUS_POLL,
    async (job: Job<PollItemPayload>) => {
      if (job.name !== QUEUE_JOB_NAMES.POLL_ITEM) {
        throw new UnrecoverableError(`Unknown job name ${job.name}`);
      }
      const started = process.hrtime.bigint();
      workerLogger.info('jobs.worker.poll.start', {
        bullJobId: job.id,
        jobItemId: job.data.jobItemId,
        tenantId: job.data.tenantId,
        attempt: job.data.attempt,
        ...(job.data.requestId ? { requestId: job.data.requestId } : {}),
      });
      try {
        const result = await lifecycle.processPollItem(job.data);
        if (result.status === 'FAILED') {
          metrics?.providerErrorsTotal.inc({
            provider: 'smsc',
            kind: 'poll_failed',
            stage: 'poll',
          });
        }
        observeWorkerJob(metrics, {
          queue: QUEUE_NAMES.JOBS_STATUS_POLL,
          status: 'completed',
          started,
        });
        return result;
      } catch (error) {
        observeWorkerJob(metrics, {
          queue: QUEUE_NAMES.JOBS_STATUS_POLL,
          status: 'failed',
          started,
        });
        recordProviderThrow(metrics, error, 'poll');
        throw error;
      }
    },
    { connection, concurrency },
  );

  const finalize = new BullWorker(
    QUEUE_NAMES.JOBS_FINALIZE,
    async (job: Job<FinalizeJobPayload>) => {
      if (job.name !== QUEUE_JOB_NAMES.FINALIZE_JOB) {
        throw new UnrecoverableError(`Unknown job name ${job.name}`);
      }
      const started = process.hrtime.bigint();
      workerLogger.info('jobs.worker.finalize.start', {
        bullJobId: job.id,
        jobId: job.data.jobId,
        tenantId: job.data.tenantId,
        ...(job.data.requestId ? { requestId: job.data.requestId } : {}),
      });
      try {
        const result = await lifecycle.processFinalizeJob(job.data);
        observeWorkerJob(metrics, {
          queue: QUEUE_NAMES.JOBS_FINALIZE,
          status: 'completed',
          started,
        });
        return result;
      } catch (error) {
        observeWorkerJob(metrics, {
          queue: QUEUE_NAMES.JOBS_FINALIZE,
          status: 'failed',
          started,
        });
        throw error;
      }
    },
    { connection, concurrency: Math.max(1, Math.floor(concurrency / 2)) },
  );

  const reconciliation = new BullWorker(
    QUEUE_NAMES.JOBS_RECONCILIATION,
    async (job: Job<ReconcileStalePayload>) => {
      if (job.name !== QUEUE_JOB_NAMES.RECONCILE_STALE) {
        throw new UnrecoverableError(`Unknown job name ${job.name}`);
      }
      const started = process.hrtime.bigint();
      try {
        const result = await lifecycle.processReconciliation(job.data ?? {});
        observeWorkerJob(metrics, {
          queue: QUEUE_NAMES.JOBS_RECONCILIATION,
          status: 'completed',
          started,
        });
        return result;
      } catch (error) {
        observeWorkerJob(metrics, {
          queue: QUEUE_NAMES.JOBS_RECONCILIATION,
          status: 'failed',
          started,
        });
        throw error;
      }
    },
    { connection, concurrency: 1 },
  );

  const retention = new BullWorker(
    QUEUE_NAMES.JOBS_RETENTION,
    async (job) => {
      if (job.name !== QUEUE_JOB_NAMES.RETENTION_SWEEP) {
        throw new UnrecoverableError(`Unknown job name ${job.name}`);
      }
      const started = process.hrtime.bigint();
      try {
        const result = onRetention ? await onRetention() : { skipped: true };
        observeWorkerJob(metrics, {
          queue: QUEUE_NAMES.JOBS_RETENTION,
          status: 'completed',
          started,
        });
        return result;
      } catch (error) {
        observeWorkerJob(metrics, {
          queue: QUEUE_NAMES.JOBS_RETENTION,
          status: 'failed',
          started,
        });
        throw error;
      }
    },
    { connection, concurrency: 1 },
  );

  const csvParse = new BullWorker(
    QUEUE_NAMES.JOBS_CSV_PARSE,
    async (job: Job<CsvParsePayload>) => {
      if (job.name !== QUEUE_JOB_NAMES.CSV_PARSE) {
        throw new UnrecoverableError(`Unknown job name ${job.name}`);
      }
      const started = process.hrtime.bigint();
      workerLogger.info('jobs.worker.csv_parse.start', {
        bullJobId: job.id,
        jobId: job.data.jobId,
        tenantId: job.data.tenantId,
        ...(job.data.requestId ? { requestId: job.data.requestId } : {}),
      });
      try {
        const result = await csvParseService.process(job.data);
        observeWorkerJob(metrics, {
          queue: QUEUE_NAMES.JOBS_CSV_PARSE,
          status: 'completed',
          started,
        });
        return result;
      } catch (error) {
        observeWorkerJob(metrics, {
          queue: QUEUE_NAMES.JOBS_CSV_PARSE,
          status: 'failed',
          started,
        });
        throw error;
      }
    },
    { connection, concurrency: Math.max(1, Math.floor(concurrency / 2)) },
  );

  for (const worker of [submit, poll, finalize, reconciliation, retention, csvParse]) {
    worker.on('ready', () => {
      workerLogger.info('jobs.worker.ready', { queue: worker.name });
    });
    worker.on('completed', (job) => {
      workerLogger.info('jobs.worker.completed', {
        queue: worker.name,
        bullJobId: job.id,
        jobId: (job.data as { jobId?: string } | undefined)?.jobId,
        jobItemId: (job.data as { jobItemId?: string } | undefined)?.jobItemId,
      });
    });
    worker.on('failed', (job, error) => {
      if (worker === submit) {
        return;
      }
      workerLogger.error('jobs.worker.failed', {
        queue: worker.name,
        bullJobId: job?.id,
        jobId: (job?.data as { jobId?: string } | undefined)?.jobId,
        jobItemId: (job?.data as { jobItemId?: string } | undefined)?.jobItemId,
        message: error.message,
      });
    });
  }

  return { submit, poll, finalize, reconciliation, retention, csvParse };
}

function recordProviderThrow(
  metrics: WorkerMetrics | undefined,
  error: unknown,
  stage: 'submit' | 'poll',
): void {
  if (!metrics || !isProviderError(error)) {
    return;
  }
  metrics.providerErrorsTotal.inc({
    provider: error.providerCode || 'smsc',
    kind: error.kind,
    stage,
  });
}
