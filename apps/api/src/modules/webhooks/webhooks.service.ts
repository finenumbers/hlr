import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { ALL_WEBHOOK_EVENTS, isWebhookEventType } from '@finenumbers/webhooks';

import type { PaginatedResult } from '../../common/dto/pagination-query.dto';
import { ErrorCodes } from '../../common/errors/error-codes';
import { AppLogger } from '../../common/logger/app-logger.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateWebhookDto } from './dto/create-webhook.dto';
import type { UpdateWebhookDto } from './dto/update-webhook.dto';
import type { WebhookCreatedResponseDto } from './dto/webhook-created-response.dto';
import type { WebhookDeliveryResponseDto } from './dto/webhook-delivery-response.dto';
import type { WebhookEndpointResponseDto } from './dto/webhook-endpoint-response.dto';

const endpointSelect = {
  id: true,
  tenantId: true,
  url: true,
  description: true,
  enabled: true,
  events: true,
  consecutiveFailures: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly logger: AppLogger,
  ) {}

  async listByTenant(
    tenantId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<WebhookEndpointResponseDto>> {
    const skip = (page - 1) * pageSize;
    const where = { tenantId };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.webhookEndpoint.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: endpointSelect,
      }),
      this.prisma.webhookEndpoint.count({ where }),
    ]);

    return { items: items.map(mapEndpoint), page, pageSize, total };
  }

  async getByIdForTenant(
    tenantId: string,
    id: string,
  ): Promise<WebhookEndpointResponseDto> {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({
      where: { id, tenantId },
      select: endpointSelect,
    });

    if (!endpoint) {
      throw new NotFoundException({
        errorCode: ErrorCodes.NOT_FOUND,
        message: `Webhook endpoint ${id} not found`,
      });
    }

    return mapEndpoint(endpoint);
  }

  async createForTenant(input: {
    tenantId: string;
    dto: CreateWebhookDto;
    actorApiKeyId?: string | null;
    actorUserId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<WebhookCreatedResponseDto> {
    const events = normalizeEvents(input.dto.events);
    const secret = generateWebhookSecret();

    const created = await this.prisma.webhookEndpoint.create({
      data: {
        tenantId: input.tenantId,
        url: input.dto.url,
        secret,
        description: input.dto.description ?? null,
        enabled: input.dto.enabled ?? true,
        events,
      },
      select: endpointSelect,
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
      action: 'webhook.created',
      targetType: 'WebhookEndpoint',
      targetId: created.id,
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: { url: created.url, events: created.events },
    });

    this.logger.log(
      {
        message: 'webhook.created',
        tenantId: input.tenantId,
        endpointId: created.id,
      },
      'Webhooks',
    );

    return { ...mapEndpoint(created), secret };
  }

  async updateForTenant(input: {
    tenantId: string;
    id: string;
    dto: UpdateWebhookDto;
    actorApiKeyId?: string | null;
    actorUserId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<WebhookEndpointResponseDto> {
    await this.requireTenantEndpoint(input.tenantId, input.id);

    const data: {
      url?: string;
      description?: string | null;
      events?: string[];
      enabled?: boolean;
      consecutiveFailures?: number;
    } = {};
    if (input.dto.url !== undefined) data.url = input.dto.url;
    if (input.dto.description !== undefined) data.description = input.dto.description;
    if (input.dto.events !== undefined) data.events = normalizeEvents(input.dto.events);
    if (input.dto.enabled !== undefined) {
      data.enabled = input.dto.enabled;
      if (input.dto.enabled) {
        data.consecutiveFailures = 0;
      }
    }

    const updated = await this.prisma.webhookEndpoint.update({
      where: { id: input.id },
      data,
      select: endpointSelect,
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
      action: 'webhook.updated',
      targetType: 'WebhookEndpoint',
      targetId: updated.id,
      ip: input.ip,
      userAgent: input.userAgent,
      metadata: { enabled: updated.enabled, events: updated.events },
    });

    return mapEndpoint(updated);
  }

  async rotateSecretForTenant(input: {
    tenantId: string;
    id: string;
    actorApiKeyId?: string | null;
    actorUserId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<WebhookCreatedResponseDto> {
    await this.requireTenantEndpoint(input.tenantId, input.id);
    const secret = generateWebhookSecret();
    const updated = await this.prisma.webhookEndpoint.update({
      where: { id: input.id },
      data: { secret, consecutiveFailures: 0 },
      select: endpointSelect,
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
      action: 'webhook.secret_rotated',
      targetType: 'WebhookEndpoint',
      targetId: updated.id,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    this.logger.log(
      {
        message: 'webhook.secret_rotated',
        tenantId: input.tenantId,
        endpointId: updated.id,
      },
      'Webhooks',
    );

    return { ...mapEndpoint(updated), secret };
  }

  async deleteForTenant(input: {
    tenantId: string;
    id: string;
    actorApiKeyId?: string | null;
    actorUserId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    await this.requireTenantEndpoint(input.tenantId, input.id);
    await this.prisma.webhookEndpoint.delete({ where: { id: input.id } });

    await this.audit.write({
      tenantId: input.tenantId,
      actorType: input.actorApiKeyId
        ? 'API_KEY'
        : input.actorUserId
          ? 'USER'
          : 'SYSTEM',
      actorApiKeyId: input.actorApiKeyId ?? null,
      actorUserId: input.actorUserId ?? null,
      action: 'webhook.deleted',
      targetType: 'WebhookEndpoint',
      targetId: input.id,
      ip: input.ip,
      userAgent: input.userAgent,
    });
  }

  async listDeliveriesForTenant(input: {
    tenantId: string;
    page: number;
    pageSize: number;
    endpointId?: string;
    status?: string;
  }): Promise<PaginatedResult<WebhookDeliveryResponseDto>> {
    const skip = (input.page - 1) * input.pageSize;
    const where = {
      tenantId: input.tenantId,
      ...(input.endpointId ? { endpointId: input.endpointId } : {}),
      ...(input.status
        ? {
            status: input.status as
              | 'PENDING'
              | 'DELIVERING'
              | 'SUCCEEDED'
              | 'FAILED'
              | 'DEAD',
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.webhookDelivery.findMany({
        where,
        skip,
        take: input.pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          tenantId: true,
          endpointId: true,
          jobItemId: true,
          eventType: true,
          status: true,
          attemptCount: true,
          maxAttempts: true,
          nextAttemptAt: true,
          lastResponseCode: true,
          lastError: true,
          deliveredAt: true,
          createdAt: true,
        },
      }),
      this.prisma.webhookDelivery.count({ where }),
    ]);

    return { items, page: input.page, pageSize: input.pageSize, total };
  }

  private async requireTenantEndpoint(tenantId: string, id: string) {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!endpoint) {
      throw new NotFoundException({
        errorCode: ErrorCodes.NOT_FOUND,
        message: `Webhook endpoint ${id} not found`,
      });
    }
    return endpoint;
  }
}

function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}

function normalizeEvents(events: string[] | undefined): string[] {
  if (!events || events.length === 0) {
    return [];
  }
  const invalid = events.filter((e) => !isWebhookEventType(e));
  if (invalid.length > 0) {
    throw new BadRequestException({
      errorCode: ErrorCodes.VALIDATION_FAILED,
      message: `Unknown webhook events: ${invalid.join(', ')}`,
      details: { allowed: ALL_WEBHOOK_EVENTS },
    });
  }
  return [...new Set(events)];
}

function mapEndpoint(endpoint: {
  id: string;
  tenantId: string;
  url: string;
  description: string | null;
  enabled: boolean;
  events: string[];
  createdAt: Date;
  updatedAt: Date;
}): WebhookEndpointResponseDto {
  return {
    id: endpoint.id,
    tenantId: endpoint.tenantId,
    url: endpoint.url,
    description: endpoint.description,
    enabled: endpoint.enabled,
    events: endpoint.events,
    createdAt: endpoint.createdAt,
    updatedAt: endpoint.updatedAt,
  };
}
