import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { RequestWithUser } from '../decorators/current-user.decorator';
import { ErrorCodes } from '../errors/error-codes';
import type { AppRole } from '../types/authenticated-user';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<AppRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException({
        errorCode: ErrorCodes.FORBIDDEN,
        message: 'Missing authenticated user for role check',
      });
    }

    const held: AppRole[] = [];
    if (user.platformRole) {
      held.push(user.platformRole);
    }
    if (user.membershipRole) {
      held.push(user.membershipRole);
    }

    const allowed = required.some((role) => held.includes(role));
    if (!allowed) {
      throw new ForbiddenException({
        errorCode: ErrorCodes.FORBIDDEN,
        message: 'Insufficient role',
      });
    }

    return true;
  }
}
