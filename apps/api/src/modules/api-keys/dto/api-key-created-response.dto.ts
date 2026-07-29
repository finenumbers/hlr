import { ApiProperty } from '@nestjs/swagger';

import { ApiKeyResponseDto } from './api-key-response.dto';

/** Returned only on create/rotate — includes one-time plaintext secret. */
export class ApiKeyCreatedResponseDto extends ApiKeyResponseDto {
  @ApiProperty({
    description:
      'Full API key. Shown only once on create/rotate; store it securely. Never returned by list/get.',
    example: 'fnk_live_abcdefghijkl_secrethere',
  })
  secret!: string;
}
