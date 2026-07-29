import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class AssignTenantTariffDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  tariffPlanId!: string;

  @ApiPropertyOptional({ example: '0.120000' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d+)?$/)
  hlrPriceOverride?: string;

  @ApiPropertyOptional({ example: '0.220000' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d+)?$/)
  pingPriceOverride?: string;
}
