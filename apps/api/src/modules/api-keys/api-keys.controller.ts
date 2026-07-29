import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Public } from '../../common/decorators/public.decorator';
import { ApiKeysService } from './api-keys.service';

@ApiTags('api-keys')
@ApiBearerAuth()
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Public()
  @Get('tenant/:tenantId')
  @ApiOperation({ summary: 'List API keys for tenant (scaffold, secrets never returned)' })
  listByTenant(@Param('tenantId') tenantId: string, @Query() query: PaginationQueryDto) {
    return this.apiKeysService.listByTenant(tenantId, query.page, query.pageSize);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get API key metadata by id (scaffold)' })
  getById(@Param('id') id: string) {
    return this.apiKeysService.getById(id);
  }

  @Public()
  @Post()
  @ApiOperation({ summary: 'Create API key (extension point — E05)' })
  create() {
    return this.apiKeysService.create();
  }
}
