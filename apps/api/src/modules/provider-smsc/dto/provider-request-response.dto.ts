import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Safe provider-request view for admin/debug.
 * Omits requestPayload / responsePayload (raw SMSC I/O stays internal).
 */
export class ProviderRequestResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  tenantId!: string;

  @ApiPropertyOptional({ nullable: true })
  jobItemId!: string | null;

  @ApiProperty({ enum: ['SEND', 'STATUS', 'COST', 'BALANCE', 'OTHER'] })
  kind!: string;

  @ApiProperty({ enum: ['PENDING', 'SUCCEEDED', 'FAILED'] })
  status!: string;

  @ApiPropertyOptional({ nullable: true })
  providerMessageId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  httpStatus!: number | null;

  @ApiProperty()
  createdAt!: Date;
}
