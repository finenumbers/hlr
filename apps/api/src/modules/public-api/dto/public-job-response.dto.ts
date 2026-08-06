import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PublicJobResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['HLR', 'PING'] })
  checkType!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  itemCount!: number;

  @ApiProperty()
  successCount!: number;

  @ApiProperty()
  failureCount!: number;

  @ApiPropertyOptional({ nullable: true })
  estimatedCost!: string | null;

  @ApiPropertyOptional({ nullable: true })
  actualCost!: string | null;

  @ApiProperty()
  currency!: string;

  @ApiPropertyOptional({ nullable: true })
  errorCode!: string | null;

  @ApiPropertyOptional({ nullable: true })
  errorMessage!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiPropertyOptional()
  progress?: {
    total: number;
    processed: number;
    success: number;
    failed: number;
    pending: number;
  };
}
