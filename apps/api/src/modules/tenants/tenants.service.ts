import { Injectable, NotFoundException } from '@nestjs/common';

import type { PaginatedResult } from '../../common/dto/pagination-query.dto';
import { ErrorCodes } from '../../common/errors/error-codes';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { TenantResponseDto } from './dto/tenant-response.dto';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(page: number, pageSize: number): Promise<PaginatedResult<TenantResponseDto>> {
    const skip = (page - 1) * pageSize;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.tenant.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          rateLimitRpm: true,
        },
      }),
      this.prisma.tenant.count(),
    ]);

    return { items, page, pageSize, total };
  }

  async getById(id: string): Promise<TenantResponseDto> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        rateLimitRpm: true,
      },
    });

    if (!tenant) {
      throw new NotFoundException({
        errorCode: ErrorCodes.NOT_FOUND,
        message: `Tenant ${id} not found`,
      });
    }

    return tenant;
  }
}
