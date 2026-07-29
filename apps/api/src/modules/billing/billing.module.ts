import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { BILLING_WORKFLOW } from '../wallets/billing-workflow.port';
import { BillingController } from './billing.controller';
import { NestBillingService } from './billing.service';

@Module({
  imports: [AuditModule],
  controllers: [BillingController],
  providers: [
    NestBillingService,
    {
      provide: BILLING_WORKFLOW,
      useExisting: NestBillingService,
    },
  ],
  exports: [NestBillingService, BILLING_WORKFLOW],
})
export class BillingModule {}
