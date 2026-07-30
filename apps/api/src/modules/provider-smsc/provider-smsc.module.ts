import { Module } from '@nestjs/common';

import { PrismaProviderPersistence } from './prisma-provider-persistence';
import { PROVIDER_SMSC } from './provider-adapter.port';
import { ProviderSmscService } from './provider-smsc.service';

@Module({
  providers: [
    PrismaProviderPersistence,
    ProviderSmscService,
    {
      provide: PROVIDER_SMSC,
      useExisting: ProviderSmscService,
    },
  ],
  exports: [ProviderSmscService, PROVIDER_SMSC],
})
export class ProviderSmscModule {}
