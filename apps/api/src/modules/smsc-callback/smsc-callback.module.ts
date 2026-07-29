import { Module } from '@nestjs/common';

import { JobsModule } from '../jobs/jobs.module';
import { ProviderSmscModule } from '../provider-smsc/provider-smsc.module';
import { SmscCallbackController } from './smsc-callback.controller';

@Module({
  imports: [ProviderSmscModule, JobsModule],
  controllers: [SmscCallbackController],
})
export class SmscCallbackModule {}
