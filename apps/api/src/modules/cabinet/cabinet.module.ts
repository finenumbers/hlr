import { Module } from '@nestjs/common';

import { ApiKeysModule } from '../api-keys/api-keys.module';
import { BillingModule } from '../billing/billing.module';
import { JobsModule } from '../jobs/jobs.module';
import { WalletsModule } from '../wallets/wallets.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { CabinetController } from './cabinet.controller';
import { CabinetService } from './cabinet.service';
import { CsvPreviewService } from './csv-preview.service';

@Module({
  imports: [
    WalletsModule,
    BillingModule,
    JobsModule,
    ApiKeysModule,
    WebhooksModule,
  ],
  controllers: [CabinetController],
  providers: [CabinetService, CsvPreviewService],
})
export class CabinetModule {}
