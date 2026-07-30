import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ApiKeysService } from './api-keys.service';

@Module({
  imports: [AuditModule],
  providers: [ApiKeysService],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
