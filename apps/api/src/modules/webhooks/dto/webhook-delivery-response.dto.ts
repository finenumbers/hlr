import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WebhookDeliveryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  tenantId!: string;

  @ApiProperty()
  endpointId!: string;

  @ApiPropertyOptional({ nullable: true })
  jobItemId!: string | null;

  @ApiProperty()
  eventType!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  attemptCount!: number;

  @ApiProperty()
  maxAttempts!: number;

  @ApiPropertyOptional({ nullable: true })
  nextAttemptAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  lastResponseCode!: number | null;

  @ApiPropertyOptional({ nullable: true })
  lastError!: string | null;

  @ApiPropertyOptional({ nullable: true })
  deliveredAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;
}
