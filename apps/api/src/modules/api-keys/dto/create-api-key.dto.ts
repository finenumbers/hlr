import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateApiKeyDto {
  @ApiProperty({ example: 'Production backend' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ type: [String], example: [] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];

  @ApiPropertyOptional({ description: 'Optional RPM override for this key' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  rateLimitRpm?: number;
}
