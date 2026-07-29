import {
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';

import type { RequestWithUser } from './current-user.decorator';
import { ErrorCodes } from '../errors/error-codes';

/**
 * Resolves active tenant for cabinet routes from AuthenticatedUser.tenantId
 * (populated from X-Tenant-Id by AuthService).
 */
export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    const tenantId = request.user?.tenantId;
    if (!tenantId) {
      throw new ForbiddenException({
        errorCode: ErrorCodes.FORBIDDEN,
        message: 'X-Tenant-Id header with an active membership is required',
      });
    }
    if (!request.user?.membershipRole && !request.user?.platformRole) {
      throw new ForbiddenException({
        errorCode: ErrorCodes.FORBIDDEN,
        message: 'Tenant membership required',
      });
    }
    // Cabinet: platform operators without membership must not impersonate via header alone.
    if (!request.user.membershipRole) {
      throw new ForbiddenException({
        errorCode: ErrorCodes.FORBIDDEN,
        message: 'Tenant membership required for cabinet access',
      });
    }
    return tenantId;
  },
);
