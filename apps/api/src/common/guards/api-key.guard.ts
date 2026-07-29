import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import type { RequestWithApiKey } from '../decorators/current-api-key.decorator';
import { ErrorCodes } from '../errors/error-codes';
import { AppConfigService } from '../config/app-config.service';
import { AppLogger } from '../logger/app-logger.service';
import { PrismaService } from '../prisma/prisma.service';
import { RequestContextService } from '../request-context/request-context.service';
import {
  parseApiKey,
  verifyApiKeySecret,
} from '../../modules/api-keys/api-key-crypto';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly requestContext: RequestContextService,
    private readonly logger: AppLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithApiKey>();
    const header = request.headers.authorization;
    if (!header || typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        errorCode: ErrorCodes.UNAUTHORIZED,
        message: 'Missing or invalid Authorization Bearer API key',
      });
    }

    const rawKey = header.slice('Bearer '.length).trim();
    const parsed = parseApiKey(rawKey);
    if (!parsed) {
      throw new UnauthorizedException({
        errorCode: ErrorCodes.UNAUTHORIZED,
        message: 'Invalid API key format',
      });
    }

    const record = await this.prisma.apiKey.findUnique({
      where: { prefix: parsed.prefix },
      select: {
        id: true,
        tenantId: true,
        name: true,
        prefix: true,
        secretHash: true,
        scopes: true,
        rateLimitRpm: true,
        expiresAt: true,
        revokedAt: true,
        tenant: { select: { status: true } },
      },
    });

    if (!record) {
      throw new UnauthorizedException({
        errorCode: ErrorCodes.UNAUTHORIZED,
        message: 'Invalid API key',
      });
    }

    if (record.revokedAt) {
      throw new UnauthorizedException({
        errorCode: ErrorCodes.API_KEY_REVOKED,
        message: 'API key has been revoked',
      });
    }

    if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({
        errorCode: ErrorCodes.API_KEY_EXPIRED,
        message: 'API key has expired',
      });
    }

    if (record.tenant.status !== 'ACTIVE') {
      throw new UnauthorizedException({
        errorCode: ErrorCodes.FORBIDDEN,
        message: 'Tenant is not active',
      });
    }

    const valid = verifyApiKeySecret({
      secret: parsed.secret,
      secretHash: record.secretHash,
      pepper: this.config.apiKeyPepper,
    });
    if (!valid) {
      this.logger.warn(
        { message: 'api_key.auth.invalid_secret', prefix: record.prefix },
        'ApiKeyGuard',
      );
      throw new UnauthorizedException({
        errorCode: ErrorCodes.UNAUTHORIZED,
        message: 'Invalid API key',
      });
    }

    request.apiKey = {
      apiKeyId: record.id,
      tenantId: record.tenantId,
      prefix: record.prefix,
      name: record.name,
      scopes: record.scopes,
      rateLimitRpm: record.rateLimitRpm,
    };

    this.requestContext.setTenantId(record.tenantId);

    // Fire-and-forget lastUsedAt (do not block auth path on write failures).
    void this.prisma.apiKey
      .update({
        where: { id: record.id },
        data: { lastUsedAt: new Date() },
      })
      .catch((error: unknown) => {
        this.logger.warn(
          {
            message: 'api_key.last_used_update_failed',
            apiKeyId: record.id,
            error: error instanceof Error ? error.message : String(error),
          },
          'ApiKeyGuard',
        );
      });

    return true;
  }
}
