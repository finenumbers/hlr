import {
  WEBHOOK_QUEUE_DEFAULT_JOB_OPTIONS,
  WEBHOOK_QUEUE_JOB_NAMES,
  WEBHOOK_QUEUE_NAMES,
  type WebhookDeliverPayload,
  type WebhookQueuePublisher,
} from '@finenumbers/webhooks';
import { Queue } from 'bullmq';
import type IORedis from 'ioredis';

import { workerLogger } from './logger';

export class WorkerWebhookQueuePublisher implements WebhookQueuePublisher {
  private readonly deliverQueue: Queue<WebhookDeliverPayload>;

  constructor(connection: IORedis) {
    this.deliverQueue = new Queue(WEBHOOK_QUEUE_NAMES.WEBHOOKS_DELIVER, {
      connection,
      defaultJobOptions: WEBHOOK_QUEUE_DEFAULT_JOB_OPTIONS.deliver,
    });
  }

  async enqueueDeliver(payload: WebhookDeliverPayload, delayMs = 0): Promise<void> {
    await this.deliverQueue.add(WEBHOOK_QUEUE_JOB_NAMES.DELIVER, payload, {
      delay: Math.max(0, delayMs),
    });
    workerLogger.info('webhooks.queue.enqueue_deliver', {
      deliveryId: payload.deliveryId,
      delayMs,
    });
  }

  async close(): Promise<void> {
    await this.deliverQueue.close();
  }
}
