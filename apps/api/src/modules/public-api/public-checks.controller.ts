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
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ApiRateLimitZone } from '../../common/rate-limit/rate-limit-zone';
import type { AuthenticatedApiKey } from '../../common/types/authenticated-api-key';
import { JobsService } from '../jobs/jobs.service';
import { ListJobsQueryDto } from './dto/list-jobs-query.dto';
import { PublicJobResponseDto } from './dto/public-job-response.dto';
import { SubmitCheckDto } from './dto/submit-check.dto';
import { PublicApiService } from './public-api.service';

@ApiTags('v1')
@ApiKeyAuth()
@ApiRateLimitZone('read')
@ApiStandardErrors()
@Controller('v1')
export class PublicChecksController {
  constructor(
    private readonly publicApi: PublicApiService,
    private readonly jobs: JobsService,
  ) {}

  @Post('checks')
  @ApiRateLimitZone('submit')
  @ApiOperation({
    summary: 'Submit a single HLR or Ping check (async)',
    description:
      'Returns 202 immediately. Poll GET /v1/checks/:id or receive a webhook.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Replay-safe create key (recommended)',
  })
  @ApiResponse({ status: 202, type: PublicJobResponseDto })
  async submitCheck(
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
    @Body() dto: SubmitCheckDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.publicApi.submitCheck({
      apiKey,
      dto,
      idempotencyKey: idempotencyKey?.trim() || undefined,
      path: '/v1/checks',
    });
    res.status(result.statusCode);
    return result.body;
  }

  @Get('checks')
  @ApiOperation({ summary: 'List check/job submissions for the tenant' })
  async listChecks(
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

  @Get('checks/:id')
  @ApiOperation({
    summary: 'Get check/job status and result',
    description:
      'Accepts a job id (from create) or a job-item id. Normalized result is in `items`.',
  })
  async getCheck(
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
  ) {
    const jobId = await this.jobs.findJobIdForTenant(apiKey.tenantId, id);
    if (jobId) {
      const job = await this.jobs.getByIdForTenant(apiKey.tenantId, jobId);
      const items = await this.jobs.listItemsForTenant({
        tenantId: apiKey.tenantId,
        jobId: job.id,
        page: query.page,
        pageSize: query.pageSize,
      });
      return {
        ...this.publicApi.mapJob(job),
        items: items.items,
      };
    }

    const item = await this.jobs.getItemForTenant(apiKey.tenantId, id);
    const job = await this.jobs.getByIdForTenant(apiKey.tenantId, item.jobId);
    return {
      ...this.publicApi.mapJob(job),
      items: [item],
    };
  }
}
