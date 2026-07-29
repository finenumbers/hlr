import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  WEBHOOK_QUEUE_DEFAULT_JOB_OPTIONS,
  WEBHOOK_QUEUE_JOB_NAMES,
  WEBHOOK_QUEUE_NAMES,
  type WebhookDeliverPayload,
  type WebhookQueuePublisher,
} from '@finenumbers/webhooks';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { AppConfigService } from '../../common/config/app-config.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { WebhookDeliveryPort } from './webhook-delivery.port';

@Injectable()
export class BullMqWebhookPublisher
  extends WebhookDeliveryPort
  implements WebhookQueuePublisher, OnModuleInit, OnModuleDestroy
{
  private connection: IORedis | null = null;
  private deliverQueue: Queue | null = null;

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
    this.deliverQueue = new Queue(WEBHOOK_QUEUE_NAMES.WEBHOOKS_DELIVER, {
      connection: this.connection,
      defaultJobOptions: WEBHOOK_QUEUE_DEFAULT_JOB_OPTIONS.deliver,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.deliverQueue?.close();
    if (this.connection && this.connection.status !== 'end') {
      await this.connection.quit();
    }
  }

  override async enqueueDelivery(deliveryId: string): Promise<void> {
    await this.enqueueDeliver({ deliveryId });
  }

  override async enqueueForEvent(_input: {
    tenantId: string;
    eventType: string;
    jobItemId?: string;
    payload: unknown;
  }): Promise<void> {
    // Fan-out is handled by WebhookDeliveryService in the worker hooks path.
    this.logger.warn(
      { message: 'webhooks.port.enqueue_for_event_noop' },
      'Webhooks',
    );
  }

  async enqueueDeliver(payload: WebhookDeliverPayload, delayMs = 0): Promise<void> {
    if (!this.deliverQueue) {
      throw new Error('Webhook deliver queue is not initialized');
    }
    await this.deliverQueue.add(WEBHOOK_QUEUE_JOB_NAMES.DELIVER, payload, {
      delay: Math.max(0, delayMs),
      jobId: delayMs > 0 ? undefined : `deliver:${payload.deliveryId}:${Date.now()}`,
    });
    this.logger.log(
      {
        message: 'webhooks.queue.enqueue_deliver',
        deliveryId: payload.deliveryId,
        delayMs,
      },
      'Webhooks',
    );
  }
}
