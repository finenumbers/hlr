import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import {
  WebhookDeliveryService,
  type WebhookQueuePublisher,
} from '@finenumbers/webhooks';

import { AppLogger } from '../../common/logger/app-logger.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BullMqWebhookPublisher } from './bullmq-webhook.publisher';
import { WEBHOOK_DELIVERY } from './webhook-delivery.port';

/**
 * Nest wrapper around WebhookDeliveryService for DI (jobs hooks / future callback path).
 */
@Injectable()
export class NestWebhookDeliveryService implements OnModuleInit {
  private core!: WebhookDeliveryService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLogger,
    @Inject(WEBHOOK_DELIVERY) private readonly queue: BullMqWebhookPublisher,
  ) {}

  onModuleInit(): void {
    this.core = new WebhookDeliveryService({
      prisma: this.prisma,
      queue: this.queue as WebhookQueuePublisher,
      logger: {
        debug: (message, fields) => this.logger.debug({ message, ...fields }, 'Webhooks'),
        info: (message, fields) => this.logger.log({ message, ...fields }, 'Webhooks'),
        warn: (message, fields) => this.logger.warn({ message, ...fields }, 'Webhooks'),
        error: (message, fields) => this.logger.error({ message, ...fields }, 'Webhooks'),
      },
    });
  }

  getCore(): WebhookDeliveryService {
    return this.core;
  }
}
