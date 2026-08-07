/**
 * Canonical BullMQ queue names for the jobs subsystem.
 * Keep in sync with apps/worker processors and api enqueue side.
 */
export const QUEUE_NAMES = {
  JOBS_SUBMIT: 'jobs-submit',
  JOBS_STATUS_POLL: 'jobs-status-poll',
  JOBS_FINALIZE: 'jobs-finalize',
  JOBS_RECONCILIATION: 'jobs-reconciliation',
  JOBS_RETENTION: 'jobs-retention',
  JOBS_CSV_PARSE: 'jobs-csv-parse',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Job names within queues (BullMQ `job.name`). */
export const QUEUE_JOB_NAMES = {
  SUBMIT_BATCH: 'submit-batch',
  /** Durable heal after submit BullMQ attempts exhausted (not fire-and-forget). */
  SUBMIT_DLQ_HEAL: 'submit-dlq-heal',
  POLL_ITEM: 'poll-item',
  FINALIZE_JOB: 'finalize-job',
  RECONCILE_STALE: 'reconcile-stale',
  RETENTION_SWEEP: 'retention-sweep',
  CSV_PARSE: 'csv-parse',
} as const;

export type QueueJobName = (typeof QUEUE_JOB_NAMES)[keyof typeof QUEUE_JOB_NAMES];

/** Default BullMQ retry / backoff for submit & finalize (not for poll scheduling). */
export const QUEUE_DEFAULT_JOB_OPTIONS = {
  submit: {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 2_000 },
    removeOnComplete: { count: 1_000 },
    removeOnFail: { count: 5_000 },
  },
  poll: {
    /** Poll cadence is app-driven via delayed re-enqueue; keep BullMQ attempts low. */
    attempts: 2,
    backoff: { type: 'exponential' as const, delay: 5_000 },
    removeOnComplete: { count: 1_000 },
    removeOnFail: { count: 5_000 },
  },
  finalize: {
    attempts: 5,
    backoff: { type: 'exponential' as const, delay: 1_000 },
    // Drop immediately so an early no-op finalize (pending > 0) does not
    // block later finalize:${jobId} enqueues via BullMQ jobId dedupe.
    removeOnComplete: true,
    removeOnFail: { count: 1_000 },
  },
  reconciliation: {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 10_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
  retention: {
    attempts: 2,
    backoff: { type: 'exponential' as const, delay: 30_000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
  },
  csvParse: {
    attempts: 2,
    backoff: { type: 'exponential' as const, delay: 5_000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 1_000 },
  },
} as const;

/** How often the reconciliation worker should run (ms). */
export const RECONCILIATION_INTERVAL_MS = 60_000;

/** How often retention sweep should run (ms). Default: daily. */
export const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Default per-batch size when fan-out enqueueing submit work. */
export const DEFAULT_SUBMIT_BATCH_SIZE = 50;

/** Fallback platform settings when DB row is unavailable (tests / degraded). */
export const DEFAULT_JOB_RUNTIME_SETTINGS = {
  maxBatchPhones: 1_000,
  maxCsvRows: 100_000,
  maxCsvBytes: 52_428_800,
  checkTimeoutSec: 3_600,
  pollIntervalSec: 30,
  /** Soft cap on poll attempts before timeout path wins. */
  pollMaxAttempts: 120,
  submitBatchSize: DEFAULT_SUBMIT_BATCH_SIZE,
} as const;
