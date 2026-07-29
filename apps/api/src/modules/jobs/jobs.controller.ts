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

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ErrorCodes } from '../../common/errors/error-codes';
import { CreateJobDto } from './dto/create-job.dto';
import { JobsService } from './jobs.service';

/**
 * Internal/scaffold jobs routes. Not part of the public `/v1` contract.
 * Intentionally NOT @Public() — unscoped get-by-id would leak across tenants.
 * Clients must use `/v1/jobs/*` with API key auth (tenant-scoped).
 */
@ApiTags('jobs')
@ApiBearerAuth()
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get('tenant/:tenantId')
  @ApiOperation({
    summary: 'List jobs for tenant (internal scaffold — requires session auth)',
  })
  listByTenant(@Param('tenantId') tenantId: string, @Query() query: PaginationQueryDto) {
    return this.jobsService.listByTenant(tenantId, query.page, query.pageSize);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Get job by id (internal). Prefer GET /v1/jobs/:id — tenant isolation via API key.',
  })
  getById(@Param('id') id: string, @Query('tenantId') tenantId?: string) {
    // Never return a job by bare id — always require an explicit tenant scope.
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
    summary: 'Create job (internal scaffold — requires session auth)',
  })
  create(@Body() body: CreateJobDto) {
    return this.jobsService.create(body);
  }
}
