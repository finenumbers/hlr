import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Public } from '../../common/decorators/public.decorator';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List users (scaffold)' })
  list(@Query() query: PaginationQueryDto) {
    return this.usersService.list(query.page, query.pageSize);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get user by id (scaffold)' })
  getById(@Param('id') id: string) {
    return this.usersService.getById(id);
  }
}
