import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { ListItemsQueryDto } from '../../common/dto/list-items-query.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ErrorCodes } from '../../common/errors/error-codes';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { CreateApiKeyDto } from '../api-keys/dto/create-api-key.dto';
import { csvUploadInterceptor } from '../jobs/csv-upload.interceptor';
import { CreateWebhookDto } from '../webhooks/dto/create-webhook.dto';
import { UpdateWebhookDto } from '../webhooks/dto/update-webhook.dto';
import { CabinetService } from './cabinet.service';
import { CsvPreviewService } from './csv-preview.service';
import { RequestContextService } from '../../common/request-context/request-context.service';

class CabinetSubmitDto {
  @ApiProperty({ enum: ['HLR', 'PING'] })
  @IsIn(['HLR', 'PING'])
  checkType!: 'HLR' | 'PING';

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100_000)
  @IsString({ each: true })
  phones!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

class CabinetEstimateDto {
  @ApiProperty({ enum: ['HLR', 'PING'] })
  @IsIn(['HLR', 'PING'])
  checkType!: 'HLR' | 'PING';

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  unitCount!: number;
}

class CabinetJobsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  checkType?: string;
}

class CabinetDeliveriesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  endpointId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;
}

@ApiTags('cabinet')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Tenant-Id', required: true })
@Roles('OWNER', 'ADMIN', 'MEMBER')
@Controller('cabinet')
export class CabinetController {
  constructor(
    private readonly cabinet: CabinetService,
    private readonly csvPreviews: CsvPreviewService,
    private readonly requestContext: RequestContextService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Tenant ops dashboard' })
  dashboard(@TenantId() tenantId: string) {
    return this.cabinet.dashboard(tenantId);
  }

  @Post('billing/estimate')
  estimate(@TenantId() tenantId: string, @Body() dto: CabinetEstimateDto) {
    return this.cabinet.estimate(tenantId, dto.checkType, dto.unitCount);
  }

  @Post('csv-previews')
  @UseInterceptors(csvUploadInterceptor())
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'checkType'],
      properties: {
        checkType: { type: 'string', enum: ['HLR', 'PING'] },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload CSV for preview only (no checks until Submit)',
  })
  createCsvPreview(
    @TenantId() tenantId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('checkType') checkType: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file?.path) {
      throw new BadRequestException({
        errorCode: ErrorCodes.VALIDATION_FAILED,
        message: 'file is required (multipart field "file")',
      });
    }
    if (checkType !== 'HLR' && checkType !== 'PING') {
      throw new BadRequestException({
        errorCode: ErrorCodes.VALIDATION_FAILED,
        message: 'checkType must be HLR or PING',
      });
    }
    return this.csvPreviews.createFromUpload({
      tenantId,
      checkType,
      file: {
        path: file.path,
        originalname: file.originalname,
        size: file.size,
      },
      createdByUserId: user.userId,
    });
  }

  @Get('csv-previews/:id')
  @ApiOperation({ summary: 'CSV preview meta + first phones page' })
  getCsvPreview(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.csvPreviews.getForTenant(tenantId, id);
  }

  @Get('csv-previews/:id/phones')
  @ApiOperation({ summary: 'Paginated phones for a CSV preview' })
  listCsvPreviewPhones(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.csvPreviews.listPhones(
      tenantId,
      id,
      query.page ?? 1,
      query.pageSize ?? 50,
    );
  }

  @Post('csv-previews/:id/estimate')
  @ApiOperation({ summary: 'Estimate cost for a READY CSV preview' })
  estimateCsvPreview(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.csvPreviews.estimate(tenantId, id);
  }

  @Post('csv-previews/:id/submit')
  @ApiOperation({
    summary: 'Submit CSV preview — only point that starts checks',
  })
  submitCsvPreview(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.csvPreviews.submit({
      tenantId,
      previewId: id,
      createdByUserId: user.userId,
      requestId: this.requestContext.requestId,
    });
  }

  @Post('checks')
  submitSingle(
    @TenantId() tenantId: string,
    @Body() dto: CabinetSubmitDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const phone = dto.phones[0];
    if (!phone) {
      return this.cabinet.createJob({
        tenantId,
        checkType: dto.checkType,
        phones: dto.phones,
        source: 'SINGLE',
        createdByUserId: user.userId,
        idempotencyKey: dto.idempotencyKey,
      });
    }
    return this.cabinet.createJob({
      tenantId,
      checkType: dto.checkType,
      phones: [phone],
      source: 'SINGLE',
      createdByUserId: user.userId,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  @Post('jobs')
  submitBulk(
    @TenantId() tenantId: string,
    @Body() dto: CabinetSubmitDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cabinet.createJob({
      tenantId,
      checkType: dto.checkType,
      phones: dto.phones,
      source: dto.phones.length === 1 ? 'SINGLE' : 'BULK',
      createdByUserId: user.userId,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  @Post('jobs/csv')
  @UseInterceptors(csvUploadInterceptor())
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'checkType'],
      properties: {
        checkType: { type: 'string', enum: ['HLR', 'PING'] },
        file: { type: 'string', format: 'binary' },
        idempotencyKey: { type: 'string' },
      },
    },
  })
  @ApiOperation({ summary: 'Submit bulk job from CSV/TXT (async parse queue)' })
  submitCsv(
    @TenantId() tenantId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('checkType') checkType: string,
    @Body('idempotencyKey') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file?.path) {
      throw new BadRequestException({
        errorCode: ErrorCodes.VALIDATION_FAILED,
        message: 'file is required (multipart field "file")',
      });
    }
    if (checkType !== 'HLR' && checkType !== 'PING') {
      throw new BadRequestException({
        errorCode: ErrorCodes.VALIDATION_FAILED,
        message: 'checkType must be HLR or PING',
      });
    }
    return this.cabinet.createJobFromCsv({
      tenantId,
      checkType,
      file: {
        path: file.path,
        originalname: file.originalname,
        size: file.size,
      },
      createdByUserId: user.userId,
      idempotencyKey: idempotencyKey?.trim() || undefined,
    });
  }

  @Get('jobs')
  listJobs(@TenantId() tenantId: string, @Query() query: CabinetJobsQueryDto) {
    return this.cabinet.listJobs(tenantId, query.page, query.pageSize, {
      status: query.status,
      checkType: query.checkType,
    });
  }

  @Get('jobs/:id')
  getJob(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.cabinet.getJob(tenantId, id);
  }

  @Get('jobs/:id/items/export')
  @ApiOperation({ summary: 'Download all job item results as CSV' })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportItems(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Query('locale') localeRaw: string | undefined,
    @Res({ passthrough: true }) res: import('express').Response,
  ) {
    const locale = localeRaw === 'ru' ? 'ru' : 'en';
    const { stream, filename } = await this.cabinet.exportJobItemsCsv(
      tenantId,
      id,
      locale,
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    return new StreamableFile(stream);
  }

  @Get('jobs/:id/items')
  listItems(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Query() query: ListItemsQueryDto,
  ) {
    return this.cabinet.listJobItems(
      tenantId,
      id,
      query.page,
      query.pageSize,
      query.status,
    );
  }

  @Get('billing/balance')
  balance(@TenantId() tenantId: string) {
    return this.cabinet.getBalance(tenantId);
  }

  @Get('billing/ledger')
  ledger(@TenantId() tenantId: string) {
    return this.cabinet.listLedger(tenantId);
  }

  @Get('billing/tariff')
  tariff(@TenantId() tenantId: string) {
    return this.cabinet.getTariff(tenantId);
  }

  @Get('api-keys')
  listKeys(@TenantId() tenantId: string, @Query() query: PaginationQueryDto) {
    return this.cabinet.listApiKeys(tenantId, query.page, query.pageSize);
  }

  @Post('api-keys')
  @Roles('OWNER', 'ADMIN')
  createKey(
    @TenantId() tenantId: string,
    @Body() dto: CreateApiKeyDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.cabinet.createApiKey(tenantId, dto, user.userId, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('api-keys/:id/rotate')
  @Roles('OWNER', 'ADMIN')
  rotateKey(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.cabinet.rotateApiKey(tenantId, id, user.userId, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('api-keys/:id/revoke')
  @Roles('OWNER', 'ADMIN')
  revokeKey(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.cabinet.revokeApiKey(tenantId, id, user.userId, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('webhooks')
  listWebhooks(@TenantId() tenantId: string, @Query() query: PaginationQueryDto) {
    return this.cabinet.listWebhooks(tenantId, query.page, query.pageSize);
  }

  @Get('webhooks/summary')
  webhookSummary(@TenantId() tenantId: string) {
    return this.cabinet.webhookSummary(tenantId);
  }

  @Get('webhooks/deliveries')
  listDeliveries(
    @TenantId() tenantId: string,
    @Query() query: CabinetDeliveriesQueryDto,
  ) {
    return this.cabinet.listDeliveries(tenantId, query.page, query.pageSize, {
      endpointId: query.endpointId,
      status: query.status,
    });
  }

  @Post('webhooks')
  @Roles('OWNER', 'ADMIN')
  createWebhook(
    @TenantId() tenantId: string,
    @Body() dto: CreateWebhookDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.cabinet.createWebhook(tenantId, dto, user.userId, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Patch('webhooks/:id')
  @Roles('OWNER', 'ADMIN')
  updateWebhook(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.cabinet.updateWebhook(tenantId, id, dto, user.userId, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('webhooks/:id/rotate-secret')
  @Roles('OWNER', 'ADMIN')
  rotateWebhook(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.cabinet.rotateWebhookSecret(tenantId, id, user.userId, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('webhooks/:id')
  @HttpCode(204)
  @Roles('OWNER', 'ADMIN')
  async deleteWebhook(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<void> {
    await this.cabinet.deleteWebhook(tenantId, id, user.userId, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser, @TenantId() tenantId: string) {
    return {
      userId: user.userId,
      email: user.email,
      tenantId,
      membershipRole: user.membershipRole,
    };
  }
}
