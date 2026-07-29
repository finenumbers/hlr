import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuthMembershipDto {
  @ApiProperty()
  tenantId!: string;

  @ApiProperty({ enum: ['OWNER', 'ADMIN', 'MEMBER'] })
  role!: string;

  @ApiProperty()
  tenant!: {
    id: string;
    slug: string;
    name: string;
    status: string;
  };
}

export class AuthUserResponseDto {
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

  @ApiProperty({ type: [AuthMembershipDto] })
  memberships!: AuthMembershipDto[];
}
