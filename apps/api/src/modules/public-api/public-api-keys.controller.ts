import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiKeyAuth } from '../../common/decorators/api-key-auth.decorator';
import { ApiStandardErrors } from '../../common/decorators/api-error-responses.decorator';
import { CurrentApiKey } from '../../common/decorators/current-api-key.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ApiRateLimitZone } from '../../common/rate-limit/rate-limit-zone';
import type { AuthenticatedApiKey } from '../../common/types/authenticated-api-key';
import { ApiKeysService } from '../api-keys/api-keys.service';

@ApiTags('v1')
@ApiKeyAuth()
@ApiRateLimitZone('read')
@ApiStandardErrors()
@Controller('v1/api-keys')
export class PublicApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  @ApiOperation({ summary: 'List API keys (masked secrets)' })
  list(
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
    @Query() query: PaginationQueryDto,
  ) {
    return this.apiKeys.listByTenant(apiKey.tenantId, query.page, query.pageSize);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get API key metadata' })
  get(@CurrentApiKey() apiKey: AuthenticatedApiKey, @Param('id') id: string) {
    return this.apiKeys.getByIdForTenant(apiKey.tenantId, id);
  }
}
