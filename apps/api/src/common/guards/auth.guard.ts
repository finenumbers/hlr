import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { RequestWithUser } from '../decorators/current-user.decorator';
import { ErrorCodes } from '../errors/error-codes';
import { RequestContextService } from '../request-context/request-context.service';
import { AuthService } from '../../modules/auth/auth.service';

/**
 * Resolves Bearer session tokens into `request.user`.
 * Routes marked @Public() (including ApiKeyAuth) skip this guard.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly requestContext: RequestContextService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        errorCode: ErrorCodes.UNAUTHORIZED,
        message: 'Authentication required',
      });
    }

    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException({
        errorCode: ErrorCodes.UNAUTHORIZED,
        message: 'Authentication required',
      });
    }

    const tenantHeader = request.headers['x-tenant-id'];
    const tenantId = Array.isArray(tenantHeader) ? tenantHeader[0] : tenantHeader;

    const user = await this.authService.resolveBearer(token, tenantId);
    request.user = user;

    this.requestContext.setUserId(user.userId);
    if (user.tenantId) {
      this.requestContext.setTenantId(user.tenantId);
    }

    return true;
  }
}
