import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TariffPlanResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ['HLR', 'PING'] })
  checkType!: 'HLR' | 'PING';

  @ApiProperty()
  currency!: string;

  @ApiProperty({ example: '0.150000' })
  sellPrice!: string;

  @ApiProperty({ example: '0.050000' })
  providerCost!: string;

  @ApiProperty()
  isDefault!: boolean;

  @ApiProperty()
  isActive!: boolean;

  @ApiPropertyOptional({ nullable: true })
  description!: string | null;
}
