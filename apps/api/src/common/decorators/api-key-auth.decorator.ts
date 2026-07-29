import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';

import { Public } from './public.decorator';
import { ApiKeyGuard } from '../guards/api-key.guard';
import { ApiKeyRateLimitGuard } from '../guards/api-key-rate-limit.guard';

export const IS_API_KEY_AUTH_KEY = 'isApiKeyAuth';

/**
 * Marks a controller/route as public-API authenticated via Bearer API key.
 * Bypasses session AuthGuard (@Public) and applies ApiKeyGuard + RPM limiter.
 */
export function ApiKeyAuth() {
  return applyDecorators(
    Public(),
    SetMetadata(IS_API_KEY_AUTH_KEY, true),
    UseGuards(ApiKeyGuard, ApiKeyRateLimitGuard),
    ApiBearerAuth('ApiKey'),
  );
}
