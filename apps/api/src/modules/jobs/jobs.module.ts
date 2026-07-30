import { Module, forwardRef } from '@nestjs/common';
import { PrismaJobsStore } from '@finenumbers/jobs';

import { PrismaService } from '../../common/prisma/prisma.service';
import { BillingModule } from '../billing/billing.module';
import { ProviderSmscModule } from '../provider-smsc/provider-smsc.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { BullMqJobsPublisher } from './bullmq-jobs.publisher';
import { JOBS_PROCESSOR } from './jobs-processor.port';
import { JOBS_STORE } from './jobs-store.port';
import { JobsService } from './jobs.service';

@Module({
  imports: [ProviderSmscModule, BillingModule, forwardRef(() => WebhooksModule)],
  providers: [
    JobsService,
    BullMqJobsPublisher,
    {
      provide: JOBS_PROCESSOR,
      useExisting: BullMqJobsPublisher,
    },
    {
      provide: JOBS_STORE,
      useFactory: (prisma: PrismaService) => new PrismaJobsStore(prisma),
      inject: [PrismaService],
    },
  ],
  exports: [JobsService, JOBS_PROCESSOR, JOBS_STORE],
})
export class JobsModule {}
