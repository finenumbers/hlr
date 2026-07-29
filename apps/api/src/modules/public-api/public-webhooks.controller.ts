import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { ApiKeyAuth } from '../../common/decorators/api-key-auth.decorator';
import { ApiStandardErrors } from '../../common/decorators/api-error-responses.decorator';
import { CurrentApiKey } from '../../common/decorators/current-api-key.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ApiRateLimitZone } from '../../common/rate-limit/rate-limit-zone';
import type { AuthenticatedApiKey } from '../../common/types/authenticated-api-key';
import { CreateWebhookDto } from '../webhooks/dto/create-webhook.dto';
import { UpdateWebhookDto } from '../webhooks/dto/update-webhook.dto';
import { WebhooksService } from '../webhooks/webhooks.service';
import { ListDeliveriesQueryDto } from './dto/list-deliveries-query.dto';

@ApiTags('v1')
@ApiKeyAuth()
@ApiRateLimitZone('webhook')
@ApiStandardErrors()
@Controller('v1/webhooks')
export class PublicWebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  @ApiOperation({ summary: 'List webhook endpoints (secrets omitted)' })
  list(
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
    @Query() query: PaginationQueryDto,
  ) {
    return this.webhooks.listByTenant(apiKey.tenantId, query.page, query.pageSize);
  }

  @Get('deliveries')
  @ApiOperation({
    summary: 'List webhook deliveries (including failed / dead-letter)',
  })
  listDeliveries(
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
    @Query() query: ListDeliveriesQueryDto,
  ) {
    return this.webhooks.listDeliveriesForTenant({
      tenantId: apiKey.tenantId,
      page: query.page,
      pageSize: query.pageSize,
      endpointId: query.endpointId,
      status: query.status,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get webhook endpoint' })
  get(@CurrentApiKey() apiKey: AuthenticatedApiKey, @Param('id') id: string) {
    return this.webhooks.getByIdForTenant(apiKey.tenantId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create webhook endpoint (signing secret returned once)' })
  create(
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
    @Body() dto: CreateWebhookDto,
    @Req() req: Request,
  ) {
    return this.webhooks.createForTenant({
      tenantId: apiKey.tenantId,
      dto,
      actorApiKeyId: apiKey.apiKeyId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update webhook endpoint' })
  update(
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
    @Req() req: Request,
  ) {
    return this.webhooks.updateForTenant({
      tenantId: apiKey.tenantId,
      id,
      dto,
      actorApiKeyId: apiKey.apiKeyId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/rotate-secret')
  @ApiOperation({ summary: 'Rotate webhook signing secret (returned once)' })
  rotate(
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.webhooks.rotateSecretForTenant({
      tenantId: apiKey.tenantId,
      id,
      actorApiKeyId: apiKey.apiKeyId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete webhook endpoint' })
  async remove(
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.webhooks.deleteForTenant({
      tenantId: apiKey.tenantId,
      id,
      actorApiKeyId: apiKey.apiKeyId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
