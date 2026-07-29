import { ApiProperty } from '@nestjs/swagger';

import { WebhookEndpointResponseDto } from './webhook-endpoint-response.dto';

/** Returned on create/rotate-secret — includes one-time signing secret. */
export class WebhookCreatedResponseDto extends WebhookEndpointResponseDto {
  @ApiProperty({
    description: 'HMAC signing secret. Shown once; store it securely.',
  })
  secret!: string;
}
