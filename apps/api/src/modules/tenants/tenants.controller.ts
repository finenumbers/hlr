import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Public } from '../../common/decorators/public.decorator';
import { TenantsService } from './tenants.service';

@ApiTags('tenants')
@ApiBearerAuth()
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  /**
   * Scaffold read endpoint. Temporarily @Public for Prisma smoke tests;
   * E04/E05 will require SUPERADMIN/SUPPORT via @Roles.
   */
  @Public()
  @Get()
  @ApiOperation({ summary: 'List tenants (scaffold)' })
  list(@Query() query: PaginationQueryDto) {
    return this.tenantsService.list(query.page, query.pageSize);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get tenant by id (scaffold)' })
  getById(@Param('id') id: string) {
    return this.tenantsService.getById(id);
  }
}
