import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { TariffsService } from './tariffs.service';

@Module({
  imports: [AuditModule],
  providers: [TariffsService],
  exports: [TariffsService],
})
export class TariffsModule {}
