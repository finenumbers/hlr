import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiPropertyOptional({ nullable: true })
  name!: string | null;

  @ApiPropertyOptional({ nullable: true, enum: ['SUPERADMIN', 'SUPPORT'] })
  platformRole!: string | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  createdAt!: Date;
}
