import { ApiProperty } from '@nestjs/swagger';

import { AuthUserResponseDto } from './auth-user-response.dto';

export class AuthSessionResponseDto {
  @ApiProperty({ description: 'Opaque bearer token for Authorization header' })
  accessToken!: string;

  @ApiProperty()
  expiresAt!: Date;

  @ApiProperty({ type: AuthUserResponseDto })
  user!: AuthUserResponseDto;
}
