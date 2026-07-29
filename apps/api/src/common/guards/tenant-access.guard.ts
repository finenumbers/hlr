import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import type { RequestWithUser } from '../decorators/current-user.decorator';
import { ErrorCodes } from '../errors/error-codes';

/**
 * Ensures tenant-scoped routes cannot be accessed across tenants.
 * Platform roles (SUPERADMIN / SUPPORT) bypass the tenant match.
 *
 * Expects `:tenantId` route param when present; otherwise uses `user.tenantId`.
 */
@Injectable()
export class TenantAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser & { params: Record<string, string> }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException({
        errorCode: ErrorCodes.FORBIDDEN,
        message: 'Missing authenticated user for tenant check',
      });
    }

    if (user.platformRole === 'SUPERADMIN' || user.platformRole === 'SUPPORT') {
      return true;
    }

    const routeTenantId = request.params.tenantId;
    const effectiveTenantId = routeTenantId ?? user.tenantId;

    if (!effectiveTenantId) {
      throw new ForbiddenException({
        errorCode: ErrorCodes.FORBIDDEN,
        message: 'Tenant context required',
      });
    }

    if (user.tenantId && user.tenantId !== effectiveTenantId) {
      throw new ForbiddenException({
        errorCode: ErrorCodes.FORBIDDEN,
        message: 'Tenant access denied',
      });
    }

    return true;
  }
}
