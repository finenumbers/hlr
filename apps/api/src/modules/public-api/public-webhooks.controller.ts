import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiKeyAuth } from '../../common/decorators/api-key-auth.decorator';
import { ApiStandardErrors } from '../../common/decorators/api-error-responses.decorator';
import { CurrentApiKey } from '../../common/decorators/current-api-key.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ApiRateLimitZone } from '../../common/rate-limit/rate-limit-zone';
import type { AuthenticatedApiKey } from '../../common/types/authenticated-api-key';
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
}
