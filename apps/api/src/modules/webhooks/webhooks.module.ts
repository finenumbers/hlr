import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { BullMqWebhookPublisher } from './bullmq-webhook.publisher';
import { NestWebhookDeliveryService } from './nest-webhook-delivery.service';
import { WEBHOOK_DELIVERY } from './webhook-delivery.port';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [AuditModule],
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    BullMqWebhookPublisher,
    NestWebhookDeliveryService,
    {
      provide: WEBHOOK_DELIVERY,
      useExisting: BullMqWebhookPublisher,
    },
  ],
  exports: [
    WebhooksService,
    WEBHOOK_DELIVERY,
    BullMqWebhookPublisher,
    NestWebhookDeliveryService,
  ],
})
export class WebhooksModule {}
