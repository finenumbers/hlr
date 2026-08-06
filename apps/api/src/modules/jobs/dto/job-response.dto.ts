import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class JobResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  tenantId!: string;

  @ApiProperty({ enum: ['HLR', 'PING'] })
  checkType!: string;

  @ApiProperty({ enum: ['SINGLE', 'BULK', 'API'] })
  source!: string;

  @ApiProperty({
    enum: ['QUEUED', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED'],
  })
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
}
