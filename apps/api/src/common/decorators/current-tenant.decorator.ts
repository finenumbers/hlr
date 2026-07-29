import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { RequestWithUser } from './current-user.decorator';

/**
 * Resolves tenant id from the authenticated user, then from request context.
 */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    return request.user?.tenantId ?? undefined;
  },
);
