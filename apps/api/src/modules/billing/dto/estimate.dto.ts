import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class EstimateDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  tenantId!: string;

  @ApiProperty({ enum: ['HLR', 'PING'] })
  @IsIn(['HLR', 'PING'])
  checkType!: 'HLR' | 'PING';

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  unitCount!: number;
}
