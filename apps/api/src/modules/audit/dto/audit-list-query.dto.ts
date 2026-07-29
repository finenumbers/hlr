import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class AuditListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  actorUserId?: string;

  @ApiPropertyOptional({ enum: ['USER', 'API_KEY', 'SYSTEM'] })
  @IsOptional()
  @IsIn(['USER', 'API_KEY', 'SYSTEM'])
  actorType?: 'USER' | 'API_KEY' | 'SYSTEM';

  @ApiPropertyOptional({ description: 'Exact action or prefix (billing.wallet.)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  targetType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  targetId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tenantId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}
