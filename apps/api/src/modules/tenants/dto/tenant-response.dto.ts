import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TenantResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED', 'ARCHIVED'] })
  status!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiPropertyOptional({ nullable: true })
  rateLimitRpm?: number | null;
}
