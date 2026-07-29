import { Module } from '@nestjs/common';

import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { ApiKeyRateLimitGuard } from '../../common/guards/api-key-rate-limit.guard';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { JobsModule } from '../jobs/jobs.module';
import { WalletsModule } from '../wallets/wallets.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { PublicApiKeysController } from './public-api-keys.controller';
import { PublicApiService } from './public-api.service';
import { PublicChecksController } from './public-checks.controller';
import { PublicJobsController } from './public-jobs.controller';
import { PublicMeController } from './public-me.controller';
import { PublicWebhooksController } from './public-webhooks.controller';

@Module({
  imports: [
    JobsModule,
    WalletsModule,
    ApiKeysModule,
    WebhooksModule,
    IdempotencyModule,
  ],
  controllers: [
    PublicMeController,
    PublicChecksController,
    PublicJobsController,
    PublicApiKeysController,
    PublicWebhooksController,
  ],
  providers: [PublicApiService, ApiKeyGuard, ApiKeyRateLimitGuard],
})
export class PublicApiModule {}
