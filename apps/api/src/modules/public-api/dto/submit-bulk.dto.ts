import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SubmitBulkDto {
  @ApiProperty({ enum: ['hlr', 'ping'], example: 'hlr' })
  @IsIn(['hlr', 'ping'])
  type!: 'hlr' | 'ping';

  @ApiProperty({
    type: [String],
    example: ['+79991234567', '+79997654321'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100_000)
  @IsString({ each: true })
  @MinLength(3, { each: true })
  phones!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  clientReference?: string;
}
