import { Injectable, NotFoundException } from '@nestjs/common';

import type { PaginatedResult } from '../../common/dto/pagination-query.dto';
import { ErrorCodes } from '../../common/errors/error-codes';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { UserResponseDto } from './dto/user-response.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(page: number, pageSize: number): Promise<PaginatedResult<UserResponseDto>> {
    const skip = (page - 1) * pageSize;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          platformRole: true,
          isActive: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count(),
    ]);

    return { items, page, pageSize, total };
  }

  async getById(id: string): Promise<UserResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        platformRole: true,
        isActive: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException({
        errorCode: ErrorCodes.NOT_FOUND,
        message: `User ${id} not found`,
      });
    }

    return user;
  }
}
