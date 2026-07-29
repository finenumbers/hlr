import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** OpenAPI model for the stable public error envelope. */
export class ApiErrorBodyDto {
  @ApiProperty({
    example: 'VALIDATION_FAILED',
    description: 'Machine-readable error code for client automation',
  })
  code!: string;

  @ApiProperty({
    example: 'One or more phone numbers are invalid',
    description: 'Human-readable message',
  })
  message!: string;

  @ApiProperty({
    example: '9f3c2a1b-4d5e-6789-abcd-ef0123456789',
    description: 'Request correlation id (also in X-Request-Id header)',
  })
  requestId!: string;

  @ApiPropertyOptional({
    description: 'Optional structured details (e.g. validation issues)',
  })
  details?: unknown;
}

export class ApiErrorEnvelopeDto {
  @ApiProperty({ type: ApiErrorBodyDto })
  error!: ApiErrorBodyDto;
}
