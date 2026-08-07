import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { ApiKeyAuth } from '../../common/decorators/api-key-auth.decorator';
import { ApiStandardErrors } from '../../common/decorators/api-error-responses.decorator';
import { CurrentApiKey } from '../../common/decorators/current-api-key.decorator';
import { ErrorCodes } from '../../common/errors/error-codes';
import { ApiRateLimitZone } from '../../common/rate-limit/rate-limit-zone';
import { RequestContextService } from '../../common/request-context/request-context.service';
import type { AuthenticatedApiKey } from '../../common/types/authenticated-api-key';
import { csvUploadInterceptor } from '../jobs/csv-upload.interceptor';
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
    private readonly requestContext: RequestContextService,
  ) {}

  @Post()
  @ApiRateLimitZone('submit')
  @ApiOperation({ summary: 'Submit a bulk HLR/Ping job (async JSON phones[])' })
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

  @Post('csv')
  @ApiRateLimitZone('submit')
  @UseInterceptors(csvUploadInterceptor())
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'type'],
      properties: {
        type: { type: 'string', enum: ['hlr', 'ping'] },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Submit a bulk job from CSV/TXT file (async parse queue)' })
  @ApiResponse({ status: 202, type: PublicJobResponseDto })
  async submitCsv(
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('type') type: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!file?.path) {
      throw new BadRequestException({
        errorCode: ErrorCodes.VALIDATION_FAILED,
        message: 'file is required (multipart field "file")',
      });
    }
    const normalized = (type || '').toLowerCase();
    if (normalized !== 'hlr' && normalized !== 'ping') {
      throw new BadRequestException({
        errorCode: ErrorCodes.VALIDATION_FAILED,
        message: 'type must be hlr or ping',
      });
    }

    const result = await this.jobs.createFromCsvUpload({
      tenantId: apiKey.tenantId,
      checkType: normalized === 'hlr' ? 'HLR' : 'PING',
      file: {
        path: file.path,
        originalname: file.originalname,
        size: file.size,
      },
      idempotencyKey: idempotencyKey?.trim() || undefined,
      apiKeyId: apiKey.apiKeyId,
      requestId: this.requestContext.requestId,
    });

    res.status(202);
    return this.publicApi.mapJob({
      id: result.job.id,
      checkType: result.job.checkType,
      status: result.job.status,
      itemCount: result.job.itemCount,
      successCount: result.job.successCount,
      failureCount: result.job.failureCount,
      estimatedCost: result.job.estimatedCost,
      actualCost: result.job.actualCost,
      currency: result.job.currency,
      errorCode: result.job.errorCode ?? null,
      errorMessage: result.job.errorMessage ?? null,
      createdAt: result.job.createdAt,
      progress: result.progress,
    });
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
    const result = await this.jobs.listItemsForTenant({
      tenantId: apiKey.tenantId,
      jobId: id,
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
    });
    return {
      ...result,
      items: this.publicApi.mapItems(result.items),
    };
  }
}
