import type { EnqueueCsvParseOptions, JobsQueuePublisher } from './ports.js';
import type {
  CsvParsePayload,
  FinalizeJobPayload,
  PollItemPayload,
  ReconcileStalePayload,
  SubmitBatchPayload,
  SubmitDlqHealPayload,
} from './types.js';

export type QueuedMessage =
  | { queue: 'submit'; payload: SubmitBatchPayload; delayMs?: number }
  | { queue: 'submit-dlq-heal'; payload: SubmitDlqHealPayload; delayMs?: number }
  | { queue: 'poll'; payload: PollItemPayload; delayMs?: number }
  | { queue: 'finalize'; payload: FinalizeJobPayload; delayMs?: number }
  | { queue: 'reconciliation'; payload: ReconcileStalePayload; delayMs?: number }
  | { queue: 'csv-parse'; payload: CsvParsePayload; delayMs?: number };

/** In-memory queue publisher for unit tests. */
export class InMemoryJobsQueue implements JobsQueuePublisher {
  readonly messages: QueuedMessage[] = [];

  async enqueueSubmitBatch(payload: SubmitBatchPayload): Promise<void> {
    this.messages.push({ queue: 'submit', payload });
  }

  async enqueueSubmitDlqHeal(payload: SubmitDlqHealPayload): Promise<void> {
    this.messages.push({ queue: 'submit-dlq-heal', payload });
  }

  async enqueuePollItem(payload: PollItemPayload, delayMs?: number): Promise<void> {
    this.messages.push({ queue: 'poll', payload, delayMs });
  }

  async enqueueFinalizeJob(payload: FinalizeJobPayload): Promise<void> {
    this.messages.push({ queue: 'finalize', payload });
  }

  async enqueueReconciliation(payload: ReconcileStalePayload = {}): Promise<void> {
    this.messages.push({ queue: 'reconciliation', payload });
  }

  async enqueueCsvParse(
    payload: CsvParsePayload,
    _options?: EnqueueCsvParseOptions,
  ): Promise<void> {
    this.messages.push({ queue: 'csv-parse', payload });
  }

  clear(): void {
    this.messages.length = 0;
  }

  of(queue: QueuedMessage['queue']): QueuedMessage[] {
    return this.messages.filter((message) => message.queue === queue);
  }
}
