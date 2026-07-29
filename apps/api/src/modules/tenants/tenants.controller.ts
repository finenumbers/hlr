import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { TenantsService } from './tenants.service';

@ApiTags('tenants')
@ApiBearerAuth()
@Roles('SUPERADMIN', 'SUPPORT')
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  @ApiOperation({ summary: 'List tenants (prefer /admin/tenants)' })
  list(@Query() query: PaginationQueryDto) {
    return this.tenantsService.list(query.page, query.pageSize);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get tenant by id (prefer /admin/tenants/:id)' })
  getById(@Param('id') id: string) {
    return this.tenantsService.getById(id);
  }
}
