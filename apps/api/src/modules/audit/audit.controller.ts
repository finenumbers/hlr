import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Public } from '../../common/decorators/public.decorator';
import { AuditService } from './audit.service';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List audit log entries (scaffold)' })
  list(@Query() query: PaginationQueryDto) {
    return this.auditService.list(query.page, query.pageSize);
  }
}
