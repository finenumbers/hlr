import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { TariffsController } from './tariffs.controller';
import { TariffsService } from './tariffs.service';

@Module({
  imports: [AuditModule],
  controllers: [TariffsController],
  providers: [TariffsService],
  exports: [TariffsService],
})
export class TariffsModule {}
