import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Public } from '../../common/decorators/public.decorator';
import { AssignTenantTariffDto } from './dto/assign-tenant-tariff.dto';
import { CreateTariffPlanDto } from './dto/create-tariff-plan.dto';
import { TariffsService } from './tariffs.service';

@ApiTags('tariffs')
@ApiBearerAuth()
@Controller('tariffs')
export class TariffsController {
  constructor(private readonly tariffsService: TariffsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List tariff plans' })
  list(@Query() query: PaginationQueryDto) {
    return this.tariffsService.list(query.page, query.pageSize);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get tariff plan by id' })
  getById(@Param('id') id: string) {
    return this.tariffsService.getById(id);
  }

  @Public()
  @Post()
  @ApiOperation({ summary: 'Create tariff plan (admin)' })
  create(@Body() dto: CreateTariffPlanDto) {
    return this.tariffsService.create(dto);
  }

  @Public()
  @Post('assign')
  @ApiOperation({ summary: 'Assign tariff plan to tenant (with optional sell overrides)' })
  assign(@Body() dto: AssignTenantTariffDto) {
    return this.tariffsService.assignToTenant(dto);
  }
}
