import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class TopupDto {
  @ApiProperty({ example: 'tenant_cuid' })
  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  /** Decimal string, e.g. "100.500000" */
  @ApiProperty({ example: '100.500000' })
  @IsString()
  @Matches(/^\d+(\.\d+)?$/)
  amount!: string;

  @ApiProperty({ example: 'wire-2026-07-29-001' })
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
}
