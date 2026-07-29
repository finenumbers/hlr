import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListJobsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: [
      'QUEUED',
      'PROCESSING',
      'COMPLETED',
      'COMPLETED_WITH_ERRORS',
      'FAILED',
      'CANCELLED',
    ],
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ enum: ['HLR', 'PING'] })
  @IsOptional()
  @IsIn(['HLR', 'PING'])
  checkType?: 'HLR' | 'PING';

  @ApiPropertyOptional({
    enum: ['createdAt', '-createdAt'],
    default: '-createdAt',
  })
  @IsOptional()
  @IsIn(['createdAt', '-createdAt'])
  sort?: 'createdAt' | '-createdAt';
}
