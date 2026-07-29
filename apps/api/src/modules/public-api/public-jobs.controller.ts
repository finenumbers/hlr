import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { ApiKeyAuth } from '../../common/decorators/api-key-auth.decorator';
import { ApiStandardErrors } from '../../common/decorators/api-error-responses.decorator';
import { CurrentApiKey } from '../../common/decorators/current-api-key.decorator';
import { ApiRateLimitZone } from '../../common/rate-limit/rate-limit-zone';
import type { AuthenticatedApiKey } from '../../common/types/authenticated-api-key';
import { JobsService } from '../jobs/jobs.service';
import { ListItemsQueryDto } from './dto/list-items-query.dto';
import { ListJobsQueryDto } from './dto/list-jobs-query.dto';
import { PublicJobResponseDto } from './dto/public-job-response.dto';
import { SubmitBulkDto } from './dto/submit-bulk.dto';
import { PublicApiService } from './public-api.service';

@ApiTags('v1')
@ApiKeyAuth()
@ApiRateLimitZone('read')
@ApiStandardErrors()
@Controller('v1/jobs')
export class PublicJobsController {
  constructor(
    private readonly publicApi: PublicApiService,
    private readonly jobs: JobsService,
  ) {}

  @Post()
  @ApiRateLimitZone('submit')
  @ApiOperation({ summary: 'Submit a bulk HLR/Ping job (async)' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiResponse({ status: 202, type: PublicJobResponseDto })
  async submitBulk(
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
    @Body() dto: SubmitBulkDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.publicApi.submitBulk({
      apiKey,
      dto,
      idempotencyKey: idempotencyKey?.trim() || undefined,
      path: '/v1/jobs',
    });
    res.status(result.statusCode);
    return result.body;
  }

  @Get()
  @ApiOperation({ summary: 'List jobs with pagination/filter/sort' })
  async list(
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
    @Query() query: ListJobsQueryDto,
  ) {
    const result = await this.jobs.listByTenant(
      apiKey.tenantId,
      query.page,
      query.pageSize,
      {
        status: query.status,
        checkType: query.checkType,
        sort: query.sort,
      },
    );
    return {
      ...result,
      items: result.items.map((j) => this.publicApi.mapJob(j)),
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get job by id' })
  async get(
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
    @Param('id') id: string,
  ) {
    const job = await this.jobs.getByIdForTenant(apiKey.tenantId, id);
    return this.publicApi.mapJob(job);
  }

  @Get(':id/items')
  @ApiOperation({ summary: 'List job items/results with pagination/filter' })
  async items(
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
    @Param('id') id: string,
    @Query() query: ListItemsQueryDto,
  ) {
    return this.jobs.listItemsForTenant({
      tenantId: apiKey.tenantId,
      jobId: id,
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
    });
  }
}
