import { Module } from '@nestjs/common';

import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { JobsModule } from '../jobs/jobs.module';
import { ProviderSmscModule } from '../provider-smsc/provider-smsc.module';
import { SettingsModule } from '../settings/settings.module';
import { TariffsModule } from '../tariffs/tariffs.module';
import { TenantsModule } from '../tenants/tenants.module';
import { WalletsModule } from '../wallets/wallets.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { AdminPanelController } from './admin-panel.controller';
import { AdminPanelService } from './admin-panel.service';

@Module({
  imports: [
    TenantsModule,
    WalletsModule,
    TariffsModule,
    BillingModule,
    JobsModule,
    AuditModule,
    ProviderSmscModule,
    WebhooksModule,
    ApiKeysModule,
    SettingsModule,
  ],
  controllers: [AdminPanelController],
  providers: [AdminPanelService],
})
export class AdminPanelModule {}
