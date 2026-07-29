import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListDeliveriesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  endpointId?: string;

  @ApiPropertyOptional({
    enum: ['PENDING', 'DELIVERING', 'SUCCEEDED', 'FAILED', 'DEAD'],
  })
  @IsOptional()
  @IsString()
  status?: string;
}
