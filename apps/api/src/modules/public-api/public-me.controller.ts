import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiKeyAuth } from '../../common/decorators/api-key-auth.decorator';
import { ApiStandardErrors } from '../../common/decorators/api-error-responses.decorator';
import { CurrentApiKey } from '../../common/decorators/current-api-key.decorator';
import { ApiRateLimitZone } from '../../common/rate-limit/rate-limit-zone';
import type { AuthenticatedApiKey } from '../../common/types/authenticated-api-key';
import { PublicApiService } from './public-api.service';

@ApiTags('v1')
@ApiKeyAuth()
@ApiRateLimitZone('read')
@ApiStandardErrors()
@Controller('v1')
export class PublicMeController {
  constructor(private readonly publicApi: PublicApiService) {}

  @Get('me')
  @ApiOperation({ summary: 'Current tenant, API key, and resolved limits' })
  me(@CurrentApiKey() apiKey: AuthenticatedApiKey) {
    return this.publicApi.getMe(apiKey);
  }

  @Get('balance')
  @ApiOperation({ summary: 'Wallet balance summary' })
  balance(@CurrentApiKey() apiKey: AuthenticatedApiKey) {
    return this.publicApi.getBalance(apiKey.tenantId);
  }

  @Get('usage')
  @ApiOperation({ summary: 'Usage summary for the last 30 days' })
  usage(@CurrentApiKey() apiKey: AuthenticatedApiKey) {
    return this.publicApi.getUsageSummary(apiKey.tenantId);
  }
}
