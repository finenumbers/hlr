import { ApiProperty } from '@nestjs/swagger';

export class WalletResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  tenantId!: string;

  @ApiProperty()
  currency!: string;

  /** Decimal serialized as string for JSON safety. */
  @ApiProperty({ example: '0.000000' })
  availableBalance!: string;

  @ApiProperty({ example: '0.000000' })
  heldBalance!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  updatedAt!: Date;
}
