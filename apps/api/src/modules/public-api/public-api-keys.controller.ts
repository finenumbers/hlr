import {
  Body,
  Controller,
  Get,
  Param,
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
import { ApiKeysService } from '../api-keys/api-keys.service';
import { CreateApiKeyDto } from '../api-keys/dto/create-api-key.dto';

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

  @Post()
  @ApiRateLimitZone('webhook')
  @ApiOperation({
    summary: 'Create API key (secret returned once)',
  })
  create(
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
    @Body() dto: CreateApiKeyDto,
    @Req() req: Request,
  ) {
    return this.apiKeys.createForTenant({
      tenantId: apiKey.tenantId,
      dto,
      actorApiKeyId: apiKey.apiKeyId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/rotate')
  @ApiRateLimitZone('webhook')
  @ApiOperation({ summary: 'Rotate API key secret (new secret returned once)' })
  rotate(
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.apiKeys.rotateForTenant({
      tenantId: apiKey.tenantId,
      id,
      actorApiKeyId: apiKey.apiKeyId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/revoke')
  @ApiRateLimitZone('webhook')
  @ApiOperation({ summary: 'Revoke API key' })
  revoke(
    @CurrentApiKey() apiKey: AuthenticatedApiKey,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.apiKeys.revokeForTenant({
      tenantId: apiKey.tenantId,
      id,
      actorApiKeyId: apiKey.apiKeyId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
