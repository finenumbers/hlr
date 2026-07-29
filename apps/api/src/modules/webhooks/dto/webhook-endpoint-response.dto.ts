import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Safe view — secret is never returned from list/get scaffolds. */
export class WebhookEndpointResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  tenantId!: string;

  @ApiProperty()
  url!: string;

  @ApiPropertyOptional({ nullable: true })
  description!: string | null;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ type: [String] })
  events!: string[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
