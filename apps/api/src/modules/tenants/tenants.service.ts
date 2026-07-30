import { Injectable, NotFoundException } from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { TenantResponseDto } from './dto/tenant-response.dto';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

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
