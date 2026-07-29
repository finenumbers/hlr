import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ErrorCodes } from '../../common/errors/error-codes';
import { CreateJobDto } from './dto/create-job.dto';
import { JobsService } from './jobs.service';

/**
 * Internal scaffold jobs routes. Not part of `/v1` or `/cabinet`.
 * SUPERADMIN only — previously any authenticated user could pass an arbitrary
 * tenantId (IDOR / cross-tenant charge). Prefer `/admin/jobs` and `/cabinet/jobs`.
 */
@ApiTags('jobs')
@ApiBearerAuth()
@Roles('SUPERADMIN')
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get('tenant/:tenantId')
  @ApiOperation({
    summary: 'List jobs for tenant (SUPERADMIN scaffold — prefer GET /admin/jobs)',
  })
  listByTenant(@Param('tenantId') tenantId: string, @Query() query: PaginationQueryDto) {
    return this.jobsService.listByTenant(tenantId, query.page, query.pageSize);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get job by id (SUPERADMIN scaffold — prefer GET /admin/jobs/:id)',
  })
  getById(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    if (!tenantId?.trim()) {
      throw new BadRequestException({
        errorCode: ErrorCodes.VALIDATION_FAILED,
        message: 'Query parameter tenantId is required',
      });
    }
    return this.jobsService.getByIdForTenant(tenantId, id);
  }

  @Post()
  @ApiOperation({
    summary: 'Create job (SUPERADMIN scaffold — prefer /cabinet or /v1)',
  })
  create(@Body() body: CreateJobDto) {
    return this.jobsService.create(body);
  }
}
