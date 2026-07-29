import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateTariffPlanDto {
  @ApiPropertyOptional({ example: 'Standard' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string;

  @ApiPropertyOptional({ example: 'RUB' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @ApiPropertyOptional({ example: '0.150000' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d+)?$/)
  hlrPrice?: string;

  @ApiPropertyOptional({ example: '0.250000' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d+)?$/)
  pingPrice?: string;

  @ApiPropertyOptional({ example: '0.050000' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d+)?$/)
  hlrProviderCost?: string;

  @ApiPropertyOptional({ example: '0.080000' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d+)?$/)
  pingProviderCost?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string | null;
}
