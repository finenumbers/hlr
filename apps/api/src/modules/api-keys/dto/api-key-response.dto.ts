import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Safe API key view — never includes plaintext secret or secretHash. */
export class ApiKeyResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  tenantId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    description: 'Public lookup prefix (not the secret)',
    example: 'abcdefghijkl',
  })
  prefix!: string;

  @ApiProperty({
    description: 'Masked key for display; full secret is never returned here',
    example: 'fnk_live_abcdefghijkl_****',
  })
  masked!: string;

  @ApiProperty({ type: [String] })
  scopes!: string[];

  @ApiPropertyOptional({ nullable: true })
  lastUsedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  expiresAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  revokedAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;
}
