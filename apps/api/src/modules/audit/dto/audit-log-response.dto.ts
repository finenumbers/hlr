import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuditLogResponseDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({ nullable: true })
  tenantId!: string | null;

  @ApiProperty({ enum: ['USER', 'API_KEY', 'SYSTEM'] })
  actorType!: string;

  @ApiPropertyOptional({ nullable: true })
  actorUserId!: string | null;

  @ApiProperty()
  action!: string;

  @ApiPropertyOptional({ nullable: true })
  targetType!: string | null;

  @ApiPropertyOptional({ nullable: true })
  targetId!: string | null;

  @ApiProperty()
  createdAt!: Date;
}
