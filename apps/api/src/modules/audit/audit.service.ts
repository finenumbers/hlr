import { Injectable } from '@nestjs/common';
import type { ActorType, Prisma } from '@finenumbers/db';

import type { PaginatedResult } from '../../common/dto/pagination-query.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuditLogResponseDto } from './dto/audit-log-response.dto';
import type { AuditListQueryDto } from './dto/audit-list-query.dto';

export type WriteAuditInput = {
  tenantId?: string | null;
  actorType: ActorType;
  actorUserId?: string | null;
  actorApiKeyId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Prisma.InputJsonValue;
};

export type EnrichedAuditLogDto = {
  id: string;
  createdAt: Date;
  action: string;
  actor: {
    type: string;
    userId: string | null;
    email: string | null;
    name: string | null;
  };
  target: {
    type: string | null;
    id: string | null;
  };
  tenant: {
    id: string;
    slug: string;
    name: string;
  } | null;
  metadata: unknown;
  ip: string | null;
  userAgent: string | null;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(page: number, pageSize: number): Promise<PaginatedResult<AuditLogResponseDto>> {
    return this.search({ page, pageSize }).then((result) => ({
      items: result.items.map((row) => ({
        id: row.id,
        tenantId: row.tenant?.id ?? null,
        actorType: row.actor.type,
        actorUserId: row.actor.userId,
        action: row.action,
        targetType: row.target.type,
        targetId: row.target.id,
        createdAt: row.createdAt,
      })),
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
    }));
  }

  async search(query: AuditListQueryDto): Promise<PaginatedResult<EnrichedAuditLogDto>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.AuditLogWhereInput = {};
    if (query.actorUserId) where.actorUserId = query.actorUserId;
    if (query.actorType) where.actorType = query.actorType;
    if (query.targetType) where.targetType = query.targetType;
    if (query.targetId) where.targetId = query.targetId;
    if (query.tenantId) where.tenantId = query.tenantId;
    if (query.action) {
      if (query.action.endsWith('.') || !query.action.includes('.')) {
        where.action = { startsWith: query.action };
      } else {
        where.action = query.action;
      }
    }
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          action: true,
          actorType: true,
          actorUserId: true,
          targetType: true,
          targetId: true,
          metadata: true,
          ip: true,
          userAgent: true,
          createdAt: true,
          tenant: {
            select: { id: true, slug: true, name: true },
          },
          actorUser: {
            select: { id: true, email: true, name: true },
          },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        action: row.action,
        actor: {
          type: row.actorType,
          userId: row.actorUserId,
          email: row.actorUser?.email ?? null,
          name: row.actorUser?.name ?? null,
        },
        target: {
          type: row.targetType,
          id: row.targetId,
        },
        tenant: row.tenant,
        metadata: row.metadata,
        ip: row.ip,
        userAgent: row.userAgent,
      })),
      page,
      pageSize,
      total,
    };
  }

  async write(input: WriteAuditInput): Promise<AuditLogResponseDto> {
    return this.prisma.auditLog.create({
      data: {
        tenantId: input.tenantId ?? null,
        actorType: input.actorType,
        actorUserId: input.actorUserId ?? null,
        actorApiKeyId: input.actorApiKeyId ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        metadata: input.metadata,
      },
      select: {
        id: true,
        tenantId: true,
        actorType: true,
        actorUserId: true,
        action: true,
        targetType: true,
        targetId: true,
        createdAt: true,
      },
    });
  }
}
