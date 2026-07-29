import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateWebhookDto {
  @ApiProperty({ example: 'https://example.com/webhooks/finenumbers' })
  @IsUrl({ require_tld: false, protocols: ['https', 'http'] })
  @MaxLength(2048)
  url!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Event subscriptions. Empty = all events. Known: check.completed, check.failed, job.completed',
    example: ['check.completed', 'job.completed'],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  events?: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
