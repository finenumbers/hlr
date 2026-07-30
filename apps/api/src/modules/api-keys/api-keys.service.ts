import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import type { PaginatedResult } from '../../common/dto/pagination-query.dto';
import { AppConfigService } from '../../common/config/app-config.service';
import { ErrorCodes } from '../../common/errors/error-codes';
import { AppLogger } from '../../common/logger/app-logger.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  generateApiKeyMaterial,
  hashApiKeySecret,
  maskApiKeyPrefix,
} from './api-key-crypto';
import type { ApiKeyCreatedResponseDto } from './dto/api-key-created-response.dto';
import type { ApiKeyResponseDto } from './dto/api-key-response.dto';
import type { CreateApiKeyDto } from './dto/create-api-key.dto';

const apiKeySelect = {
  id: true,
  tenantId: true,
  name: true,
  prefix: true,
  scopes: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    private readonly logger: AppLogger,
  ) {}

  async listByTenant(
    tenantId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<ApiKeyResponseDto>> {
    const skip = (page - 1) * pageSize;
    const where = { tenantId };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.apiKey.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: apiKeySelect,
      }),
      this.prisma.apiKey.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        ...item,
        masked: maskApiKeyPrefix(item.prefix),
      })),
      page,
      pageSize,
      total,
    };
  }

  async getByIdForTenant(
    tenantId: string,
    id: string,
  ): Promise<ApiKeyResponseDto> {
    const key = await this.prisma.apiKey.findFirst({
      where: { id, tenantId },
      select: apiKeySelect,
    });

    if (!key) {
      throw new NotFoundException({
        errorCode: ErrorCodes.NOT_FOUND,
        message: `API key ${id} not found`,
      });
    }

    return { ...key, masked: maskApiKeyPrefix(key.prefix) };
  }

  async createForTenant(input: {
    tenantId: string;
    dto: CreateApiKeyDto;
    actorApiKeyId?: string | null;
    actorUserId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<ApiKeyCreatedResponseDto> {
    const material = generateApiKeyMaterial();
    const secretHash = hashApiKeySecret(material.secret, this.config.apiKeyPepper);

    const created = await this.prisma.apiKey.create({
      data: {
        tenantId: input.tenantId,
        name: input.dto.name,
        prefix: material.prefix,
        secretHash,
        scopes: input.dto.scopes ?? [],
        rateLimitRpm: input.dto.rateLimitRpm ?? null,
        createdById: input.actorUserId ?? null,
      },
      select: apiKeySelect,
    });

    await this.audit.write({
      tenantId: input.tenantId,
      actorType: input.actorApiKeyId ? 'API_KEY' : input.actorUserId ? 'USER' : 'SYSTEM',
      actorApiKeyId: input.actorApiKeyId ?? null,
      actorUserId: input.actorUserId ?? null,
      action: 'api_key.created',
      targetType: 'ApiKey',
      targetId: created.id,
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: {
        name: created.name,
        prefix: created.prefix,
        // Never include secret / raw key.
      },
    });

    this.logger.log(
      {
        message: 'api_key.created',
        tenantId: input.tenantId,
        apiKeyId: created.id,
        prefix: created.prefix,
      },
      'ApiKeys',
    );

    return {
      ...created,
      secret: material.rawKey,
      masked: maskApiKeyPrefix(created.prefix),
    };
  }

  async rotateForTenant(input: {
    tenantId: string;
    id: string;
    actorApiKeyId?: string | null;
    actorUserId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<ApiKeyCreatedResponseDto> {
    const existing = await this.requireTenantKey(input.tenantId, input.id);
    if (existing.revokedAt) {
      throw new NotFoundException({
        errorCode: ErrorCodes.NOT_FOUND,
        message: `API key ${input.id} not found`,
      });
    }

    // Keep prefix stable; rotate secret only.
    const secret = randomBytes(24).toString('base64url');
    const rawKey = `fnk_live_${existing.prefix}_${secret}`;
    const secretHash = hashApiKeySecret(secret, this.config.apiKeyPepper);

    const updated = await this.prisma.apiKey.update({
      where: { id: existing.id },
      data: { secretHash },
      select: apiKeySelect,
    });

    await this.audit.write({
      tenantId: input.tenantId,
      actorType: input.actorApiKeyId
        ? 'API_KEY'
        : input.actorUserId
          ? 'USER'
          : 'SYSTEM',
      actorApiKeyId: input.actorApiKeyId ?? null,
      actorUserId: input.actorUserId ?? null,
      action: 'api_key.rotated',
      targetType: 'ApiKey',
      targetId: updated.id,
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: { prefix: updated.prefix },
    });

    this.logger.log(
      {
        message: 'api_key.rotated',
        tenantId: input.tenantId,
        apiKeyId: updated.id,
        prefix: updated.prefix,
      },
      'ApiKeys',
    );

    return {
      ...updated,
      secret: rawKey,
      masked: maskApiKeyPrefix(updated.prefix),
    };
  }

  async revokeForTenant(input: {
    tenantId: string;
    id: string;
    actorApiKeyId?: string | null;
    actorUserId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<ApiKeyResponseDto> {
    const existing = await this.requireTenantKey(input.tenantId, input.id);
    if (existing.revokedAt) {
      return { ...existing, masked: maskApiKeyPrefix(existing.prefix) };
    }

    const updated = await this.prisma.apiKey.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
      select: apiKeySelect,
    });

    await this.audit.write({
      tenantId: input.tenantId,
      actorType: input.actorApiKeyId
        ? 'API_KEY'
        : input.actorUserId
          ? 'USER'
          : 'SYSTEM',
      actorApiKeyId: input.actorApiKeyId ?? null,
      actorUserId: input.actorUserId ?? null,
      action: 'api_key.revoked',
      targetType: 'ApiKey',
      targetId: updated.id,
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: { prefix: updated.prefix },
    });

    this.logger.log(
      {
        message: 'api_key.revoked',
        tenantId: input.tenantId,
        apiKeyId: updated.id,
        prefix: updated.prefix,
      },
      'ApiKeys',
    );

    return { ...updated, masked: maskApiKeyPrefix(updated.prefix) };
  }

  private async requireTenantKey(tenantId: string, id: string) {
    const key = await this.prisma.apiKey.findFirst({
      where: { id, tenantId },
      select: apiKeySelect,
    });
    if (!key) {
      throw new NotFoundException({
        errorCode: ErrorCodes.NOT_FOUND,
        message: `API key ${id} not found`,
      });
    }
    return key;
  }
}
