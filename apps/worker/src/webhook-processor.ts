import {
  WEBHOOK_QUEUE_JOB_NAMES,
  WEBHOOK_QUEUE_NAMES,
  type WebhookDeliverPayload,
  type WebhookDeliveryService,
} from '@finenumbers/webhooks';
import type { Job, Worker } from 'bullmq';
import { UnrecoverableError, Worker as BullWorker } from 'bullmq';
import type IORedis from 'ioredis';

import { workerLogger } from './logger';
import { observeWorkerJob, type WorkerMetrics } from './metrics';

export function createWebhookWorker(input: {
  connection: IORedis;
  concurrency: number;
  delivery: WebhookDeliveryService;
  metrics?: WorkerMetrics;
}): Worker {
  const worker = new BullWorker(
    WEBHOOK_QUEUE_NAMES.WEBHOOKS_DELIVER,
    async (job: Job<WebhookDeliverPayload>) => {
      if (job.name !== WEBHOOK_QUEUE_JOB_NAMES.DELIVER) {
        throw new UnrecoverableError(`Unknown webhook job name ${job.name}`);
      }
      const started = process.hrtime.bigint();
      workerLogger.info('webhooks.worker.deliver.start', {
        bullJobId: job.id,
        deliveryId: job.data.deliveryId,
      });
      try {
        // deliver() returns FAILED/DEAD without throwing — must read the result.
        const result = await input.delivery.deliver(job.data.deliveryId);
        const status = normalizeWebhookStatus(result.status);
        // Delivery outcome (FAILED/DEAD without throw) — separate from BullMQ job failure.
        input.metrics?.webhookDeliveriesTotal.inc({ status });
        observeWorkerJob(input.metrics, {
          queue: WEBHOOK_QUEUE_NAMES.WEBHOOKS_DELIVER,
          status: 'completed',
          started,
        });
        workerLogger.info('webhooks.worker.deliver.finished', {
          bullJobId: job.id,
          deliveryId: job.data.deliveryId,
          status,
        });
        return result;
      } catch (error) {
        input.metrics?.webhookDeliveriesTotal.inc({ status: 'failed' });
        observeWorkerJob(input.metrics, {
          queue: WEBHOOK_QUEUE_NAMES.WEBHOOKS_DELIVER,
          status: 'failed',
          started,
        });
        throw error;
      }
    },
    {
      connection: input.connection,
      concurrency: Math.max(1, Math.floor(input.concurrency / 2)),
    },
  );

  worker.on('ready', () => {
    workerLogger.info('webhooks.worker.ready', { queue: worker.name });
  });
  worker.on('failed', (job, error) => {
    workerLogger.error('webhooks.worker.failed', {
      bullJobId: job?.id,
      deliveryId: job?.data?.deliveryId,
      message: error.message,
    });
  });

  return worker;
}

function normalizeWebhookStatus(
  status: string,
): 'succeeded' | 'failed' | 'dead' {
  if (status === 'SUCCEEDED') {
    return 'succeeded';
  }
  if (status === 'DEAD') {
    return 'dead';
  }
  return 'failed';
}
