import { Module, forwardRef } from '@nestjs/common';

import { BillingModule } from '../billing/billing.module';
import { ProviderSmscModule } from '../provider-smsc/provider-smsc.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { BullMqJobsPublisher } from './bullmq-jobs.publisher';
import { JobsController } from './jobs.controller';
import { JOBS_PROCESSOR } from './jobs-processor.port';
import { JobsService } from './jobs.service';

@Module({
  imports: [ProviderSmscModule, BillingModule, forwardRef(() => WebhooksModule)],
  controllers: [JobsController],
  providers: [
    JobsService,
    BullMqJobsPublisher,
    {
      provide: JOBS_PROCESSOR,
      useExisting: BullMqJobsPublisher,
    },
  ],
  exports: [JobsService, JOBS_PROCESSOR],
})
export class JobsModule {}
