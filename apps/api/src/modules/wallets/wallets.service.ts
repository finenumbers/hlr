import { Injectable, NotFoundException } from '@nestjs/common';

import { ErrorCodes } from '../../common/errors/error-codes';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { WalletResponseDto } from './dto/wallet-response.dto';

@Injectable()
export class WalletsService {
  constructor(private readonly prisma: PrismaService) {}

  async getByTenantId(tenantId: string): Promise<WalletResponseDto> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { tenantId },
    });

    if (!wallet) {
      throw new NotFoundException({
        errorCode: ErrorCodes.NOT_FOUND,
        message: `Wallet for tenant ${tenantId} not found`,
      });
    }

    return {
      id: wallet.id,
      tenantId: wallet.tenantId,
      currency: wallet.currency,
      availableBalance: decimalToString(wallet.availableBalance),
      heldBalance: decimalToString(wallet.heldBalance),
      version: wallet.version,
      updatedAt: wallet.updatedAt,
    };
  }
}

function decimalToString(value: { toString(): string }): string {
  return value.toString();
}
