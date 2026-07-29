import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { AuthenticatedApiKey } from '../types/authenticated-api-key';

export type RequestWithApiKey = Request & {
  apiKey?: AuthenticatedApiKey;
};

export const CurrentApiKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedApiKey => {
    const request = ctx.switchToHttp().getRequest<RequestWithApiKey>();
    if (!request.apiKey) {
      throw new Error('CurrentApiKey used without ApiKeyGuard');
    }
    return request.apiKey;
  },
);
