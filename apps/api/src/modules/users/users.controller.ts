import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Roles('SUPERADMIN', 'SUPPORT')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List users (scaffold; prefer admin onboard routes)' })
  list(@Query() query: PaginationQueryDto) {
    return this.usersService.list(query.page, query.pageSize);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by id (scaffold)' })
  getById(@Param('id') id: string) {
    return this.usersService.getById(id);
  }
}
