import { Module } from '@nestjs/common';
import { NUMBER_LOOKUP_PROVIDER } from '@finenumbers/provider-core';

import { PrismaProviderPersistence } from './prisma-provider-persistence';
import { PROVIDER_SMSC } from './provider-adapter.port';
import { ProviderSmscController } from './provider-smsc.controller';
import { ProviderSmscService } from './provider-smsc.service';

@Module({
  controllers: [ProviderSmscController],
  providers: [
    PrismaProviderPersistence,
    ProviderSmscService,
    {
      provide: PROVIDER_SMSC,
      useExisting: ProviderSmscService,
    },
    {
      provide: NUMBER_LOOKUP_PROVIDER,
      useExisting: ProviderSmscService,
    },
  ],
  exports: [ProviderSmscService, PROVIDER_SMSC, NUMBER_LOOKUP_PROVIDER],
})
export class ProviderSmscModule {}
