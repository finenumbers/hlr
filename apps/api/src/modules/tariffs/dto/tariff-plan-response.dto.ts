import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TariffPlanResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ example: '0.150000' })
  hlrPrice!: string;

  @ApiProperty({ example: '0.250000' })
  pingPrice!: string;

  @ApiProperty({ example: '0.050000' })
  hlrProviderCost!: string;

  @ApiProperty({ example: '0.080000' })
  pingProviderCost!: string;

  @ApiProperty()
  isDefault!: boolean;

  @ApiProperty()
  isActive!: boolean;

  @ApiPropertyOptional({ nullable: true })
  description!: string | null;
}
