import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Public } from '../../common/decorators/public.decorator';
import { WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@ApiBearerAuth()
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Public()
  @Get('tenant/:tenantId')
  @ApiOperation({ summary: 'List webhook endpoints for tenant (scaffold, secrets omitted)' })
  listByTenant(@Param('tenantId') tenantId: string, @Query() query: PaginationQueryDto) {
    return this.webhooksService.listByTenant(tenantId, query.page, query.pageSize);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get webhook endpoint by id (scaffold)' })
  getById(@Param('id') id: string) {
    return this.webhooksService.getById(id);
  }

  @Public()
  @Post()
  @ApiOperation({ summary: 'Create webhook endpoint (extension point — E13)' })
  create() {
    return this.webhooksService.create();
  }
}
