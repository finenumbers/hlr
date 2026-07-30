import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { compare } from 'bcryptjs';

import { AppConfigService } from '../../common/config/app-config.service';
import { ErrorCodes } from '../../common/errors/error-codes';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import type { AuthSessionResponseDto } from './dto/auth-session-response.dto';
import type { AuthUserResponseDto } from './dto/auth-user-response.dto';
import type { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async login(
    dto: LoginDto,
    meta?: { ip?: string | null; userAgent?: string | null },
  ): Promise<AuthSessionResponseDto> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException({
        errorCode: ErrorCodes.UNAUTHORIZED,
        message: 'Invalid email or password',
      });
    }

    const passwordOk = await compare(dto.password, user.passwordHash);
    if (!passwordOk) {
      throw new UnauthorizedException({
        errorCode: ErrorCodes.UNAUTHORIZED,
        message: 'Invalid email or password',
      });
    }

    const accessToken = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(accessToken);
    const ttlHours = this.config.raw.SESSION_TTL_HOURS;
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    await this.prisma.$transaction([
      this.prisma.session.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
          ip: meta?.ip ?? null,
          userAgent: meta?.userAgent ?? null,
        },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      }),
    ]);

    return {
      accessToken,
      expiresAt,
      user: await this.getCurrentUserById(user.id),
    };
  }

  async logout(accessToken: string | undefined): Promise<{ ok: true }> {
    if (!accessToken) {
      return { ok: true };
    }
    const tokenHash = hashToken(accessToken);
    await this.prisma.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  async getCurrentUser(user: AuthenticatedUser): Promise<AuthUserResponseDto> {
    return this.getCurrentUserById(user.userId);
  }

  async resolveBearer(
    accessToken: string,
    tenantHeader?: string | null,
  ): Promise<AuthenticatedUser> {
    const tokenHash = hashToken(accessToken);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        expiresAt: true,
        revokedAt: true,
        user: {
          select: {
            id: true,
            email: true,
            platformRole: true,
            isActive: true,
            memberships: {
              select: {
                tenantId: true,
                role: true,
                tenant: {
                  select: {
                    status: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({
        errorCode: ErrorCodes.UNAUTHORIZED,
        message: 'Invalid or expired session',
      });
    }

    if (!session.user.isActive) {
      throw new UnauthorizedException({
        errorCode: ErrorCodes.UNAUTHORIZED,
        message: 'User is inactive',
      });
    }

    const memberships = session.user.memberships;
    let tenantId: string | null = null;
    let membershipRole: AuthenticatedUser['membershipRole'] = null;

    const assertTenantActive = (status: string) => {
      if (status !== 'ACTIVE') {
        throw new ForbiddenException({
          errorCode: ErrorCodes.FORBIDDEN,
          message: 'Tenant is not active',
        });
      }
    };

    const requested = tenantHeader?.trim() || null;
    if (requested) {
      const membership = memberships.find((m) => m.tenantId === requested);
      if (!membership) {
        // Platform operators may pass X-Tenant-Id for admin tooling; cabinet guards
        // still require membership. Here we only attach membershipRole when present.
        if (!session.user.platformRole) {
          throw new UnauthorizedException({
            errorCode: ErrorCodes.UNAUTHORIZED,
            message: 'Tenant membership required',
          });
        }
        tenantId = requested;
        membershipRole = null;
      } else {
        assertTenantActive(membership.tenant.status);
        tenantId = membership.tenantId;
        membershipRole = membership.role;
      }
    } else if (memberships.length === 1 && !session.user.platformRole) {
      assertTenantActive(memberships[0]!.tenant.status);
      tenantId = memberships[0]!.tenantId;
      membershipRole = memberships[0]!.role;
    }

    return {
      userId: session.user.id,
      email: session.user.email,
      platformRole: session.user.platformRole,
      tenantId,
      membershipRole,
    };
  }

  private async getCurrentUserById(userId: string): Promise<AuthUserResponseDto> {
    const record = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        platformRole: true,
        isActive: true,
        memberships: {
          select: {
            tenantId: true,
            role: true,
            tenant: {
              select: {
                id: true,
                slug: true,
                name: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!record || !record.isActive) {
      throw new UnauthorizedException({
        errorCode: ErrorCodes.UNAUTHORIZED,
        message: 'User not found or inactive',
      });
    }

    return {
      id: record.id,
      email: record.email,
      name: record.name,
      platformRole: record.platformRole,
      isActive: record.isActive,
      memberships: record.memberships
        .filter((m) => m.tenant.status === 'ACTIVE')
        .map((m) => ({
          tenantId: m.tenantId,
          role: m.role,
          tenant: m.tenant,
        })),
    };
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
