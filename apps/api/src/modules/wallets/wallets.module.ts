import { Module, forwardRef } from '@nestjs/common';

import { BillingModule } from '../billing/billing.module';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';

@Module({
  imports: [forwardRef(() => BillingModule)],
  controllers: [WalletsController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
