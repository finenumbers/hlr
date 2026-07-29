import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class AssignTenantTariffDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  @ApiProperty({ enum: ['HLR', 'PING'] })
  @IsIn(['HLR', 'PING'])
  checkType!: 'HLR' | 'PING';

  @ApiProperty({
    description: 'Tariff plan id for this checkType, or null/empty to unassign',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  tariffPlanId?: string | null;

  @ApiPropertyOptional({ example: '0.120000' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d+)?$/)
  priceOverride?: string;
}
