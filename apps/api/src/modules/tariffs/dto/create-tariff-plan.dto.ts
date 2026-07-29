import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateTariffPlanDto {
  @ApiProperty({ example: 'standard' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code!: string;

  @ApiProperty({ example: 'Standard' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  name!: string;

  @ApiPropertyOptional({ example: 'RUB', default: 'RUB' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @ApiProperty({ example: '0.150000' })
  @IsString()
  @Matches(/^\d+(\.\d+)?$/)
  hlrPrice!: string;

  @ApiProperty({ example: '0.250000' })
  @IsString()
  @Matches(/^\d+(\.\d+)?$/)
  pingPrice!: string;

  @ApiPropertyOptional({ example: '0.050000', default: '0' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d+)?$/)
  hlrProviderCost?: string;

  @ApiPropertyOptional({ example: '0.080000', default: '0' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d+)?$/)
  pingProviderCost?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(({ value }) => value === undefined || value === true || value === 'true')
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}
