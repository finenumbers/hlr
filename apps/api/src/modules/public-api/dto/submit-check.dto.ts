import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SubmitCheckDto {
  @ApiProperty({ example: '+79991234567' })
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  phone!: string;

  @ApiProperty({ enum: ['hlr', 'ping'], example: 'hlr' })
  @IsIn(['hlr', 'ping'])
  type!: 'hlr' | 'ping';

  @ApiPropertyOptional({
    description: 'Optional client reference stored in job metadata',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  clientReference?: string;
}
