import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateJobDto {
  @ApiProperty({ example: 'cltenant...' })
  @IsString()
  @MinLength(1)
  tenantId!: string;

  @ApiProperty({ enum: ['HLR', 'PING'] })
  @IsIn(['HLR', 'PING'])
  checkType!: 'HLR' | 'PING';

  @ApiProperty({ enum: ['SINGLE', 'BULK', 'API'] })
  @IsIn(['SINGLE', 'BULK', 'API'])
  source!: 'SINGLE' | 'BULK' | 'API';

  @ApiProperty({ type: [String], example: ['+79991234567'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100_000)
  @IsString({ each: true })
  phones!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  idempotencyKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  createdByUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  apiKeyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  originalFilename?: string;

  /** Internal: originating HTTP request id for log correlation (not a client field). */
  @ApiPropertyOptional({ writeOnly: true })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  requestId?: string;
}
