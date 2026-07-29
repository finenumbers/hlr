import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class AdjustDto {
  @ApiProperty({ example: 'tenant_cuid' })
  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  @ApiProperty({ example: '10.000000' })
  @IsString()
  @Matches(/^\d+(\.\d+)?$/)
  amount!: string;

  @ApiProperty({ enum: ['credit', 'debit'] })
  @IsIn(['credit', 'debit'])
  direction!: 'credit' | 'debit';

  @ApiProperty({ example: 'adj-2026-07-29-001' })
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 'user_cuid' })
  @IsString()
  @IsNotEmpty()
  createdById!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  allowNegative?: boolean;
}
