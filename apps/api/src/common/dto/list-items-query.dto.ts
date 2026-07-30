import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

import { PaginationQueryDto } from './pagination-query.dto';

/** Paginated job-items list; must be a real class so ValidationPipe can coerce page/pageSize. */
export class ListItemsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;
}
