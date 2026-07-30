import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AuditListQueryDto } from '../audit/dto/audit-list-query.dto';
import { AuditService } from '../audit/audit.service';
import { UpdatePlatformSettingsDto } from '../settings/dto/update-platform-settings.dto';
import { SettingsService } from '../settings/settings.service';
import { CreateTariffPlanDto } from '../tariffs/dto/create-tariff-plan.dto';
import { UpdateTariffPlanDto } from '../tariffs/dto/update-tariff-plan.dto';
import { AdminPanelService } from './admin-panel.service';

class UpdateTenantStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED', 'ARCHIVED'] })
  @IsIn(['ACTIVE', 'SUSPENDED', 'ARCHIVED'])
  status!: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
}

class CreateTenantOwnerDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ enum: ['OWNER', 'ADMIN', 'MEMBER'], default: 'OWNER' })
  @IsOptional()
  @IsIn(['OWNER', 'ADMIN', 'MEMBER'])
  role?: 'OWNER' | 'ADMIN' | 'MEMBER';
}

class CreateTenantDto {
  @ApiProperty({ example: 'acme' })
  @IsString()
  @MinLength(2)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/i)
  slug!: string;

  @ApiProperty({ example: 'Acme Corp' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  rateLimitRpm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxCsvRows?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxCsvBytes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxBatchPhones?: number;

  @ApiPropertyOptional({ type: CreateTenantOwnerDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateTenantOwnerDto)
  owner?: CreateTenantOwnerDto;
}

class CreateTenantUserDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ enum: ['OWNER', 'ADMIN', 'MEMBER'], default: 'MEMBER' })
  @IsOptional()
  @IsIn(['OWNER', 'ADMIN', 'MEMBER'])
  role?: 'OWNER' | 'ADMIN' | 'MEMBER';
}

class UpdateTenantLimitsDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(({ value }) => (value === null || value === '' ? null : value))
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  rateLimitRpm?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(({ value }) => (value === null || value === '' ? null : value))
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxCsvRows?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(({ value }) => (value === null || value === '' ? null : value))
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxCsvBytes?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(({ value }) => (value === null || value === '' ? null : value))
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxBatchPhones?: number | null;
}

class AssignTariffDto {
  @ApiProperty({ enum: ['HLR', 'PING'] })
  @IsIn(['HLR', 'PING'])
  checkType!: 'HLR' | 'PING';

  @ApiPropertyOptional({
    nullable: true,
    description: 'Plan id for this checkType; omit/null/empty to unassign',
  })
  @IsOptional()
  @IsString()
  tariffPlanId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d+)?$/)
  priceOverride?: string;
}

class AdminTopupDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  tenantId!: string;

  @ApiProperty({ example: '100.00' })
  @IsString()
  @Matches(/^\d+(\.\d+)?$/)
  amount!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  idempotencyKey!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

class AdminAdjustDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  tenantId!: string;

  @ApiProperty({ example: '10.00' })
  @IsString()
  @Matches(/^\d+(\.\d+)?$/)
  amount!: string;

  @ApiProperty({ enum: ['credit', 'debit'] })
  @IsIn(['credit', 'debit'])
  direction!: 'credit' | 'debit';

  @ApiProperty()
  @IsString()
  @MinLength(1)
  idempotencyKey!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

class AdminJobsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tenantId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  checkType?: string;
}

class AdminTenantsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;
}

class EstimateSmscCostDto {
  @ApiProperty({ enum: ['HLR', 'PING'] })
  @IsIn(['HLR', 'PING'])
  checkType!: 'HLR' | 'PING';

  @ApiProperty({ example: '+79991234567' })
  @IsString()
  @MinLength(8)
  phone!: string;
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles('SUPERADMIN', 'SUPPORT')
@Controller('admin')
export class AdminPanelController {
  constructor(
    private readonly admin: AdminPanelService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Ops dashboard snapshot' })
  dashboard() {
    return this.admin.dashboard();
  }

  @Get('tenants')
  listTenants(@Query() query: AdminTenantsQueryDto) {
    return this.admin.listTenants(query.page, query.pageSize, query.status);
  }

  @Post('tenants')
  @Roles('SUPERADMIN')
  @ApiOperation({ summary: 'Create tenant (+ optional owner user)' })
  createTenant(
    @Body() dto: CreateTenantDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.admin.createTenant(dto, user.userId, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('tenants/:id')
  getTenant(@Param('id') id: string) {
    return this.admin.getTenant(id);
  }

  @Patch('tenants/:id')
  @Roles('SUPERADMIN')
  updateTenant(
    @Param('id') id: string,
    @Body() dto: UpdateTenantStatusDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.admin.updateTenantStatus(id, dto.status, user.userId, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Patch('tenants/:id/limits')
  @Roles('SUPERADMIN')
  @ApiOperation({ summary: 'Update per-tenant limit overrides (null clears)' })
  updateTenantLimits(
    @Param('id') id: string,
    @Body() dto: UpdateTenantLimitsDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.admin.updateTenantLimits(id, dto, user.userId, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Get('tenants/:id/users')
  @ApiOperation({ summary: 'List tenant members' })
  listTenantUsers(@Param('id') id: string) {
    return this.admin.listTenantMembers(id);
  }

  @Post('tenants/:id/users')
  @Roles('SUPERADMIN')
  @ApiOperation({ summary: 'Create user + membership in tenant' })
  createTenantUser(
    @Param('id') id: string,
    @Body() dto: CreateTenantUserDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.admin.createTenantUser(id, dto, user.userId, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('tenants/:id/tariff')
  @Roles('SUPERADMIN')
  assignTariff(
    @Param('id') id: string,
    @Body() dto: AssignTariffDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.admin.assignTariff(
      id,
      {
        checkType: dto.checkType,
        tariffPlanId: dto.tariffPlanId,
        priceOverride: dto.priceOverride,
      },
      user.userId,
    );
  }

  @Get('jobs')
  listJobs(@Query() query: AdminJobsQueryDto) {
    return this.admin.listJobs({
      page: query.page,
      pageSize: query.pageSize,
      tenantId: query.tenantId,
      status: query.status,
      checkType: query.checkType,
    });
  }

  @Get('jobs/:id')
  getJob(@Param('id') id: string) {
    return this.admin.getJob(id);
  }

  @Get('jobs/:id/items')
  listJobItems(
    @Param('id') id: string,
    @Query() query: PaginationQueryDto & { status?: string },
  ) {
    return this.admin.listJobItems(id, query.page, query.pageSize, query.status);
  }

  @Post('jobs/:id/finalize')
  @Roles('SUPERADMIN')
  finalizeJob(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.admin.finalizeJob(id, user.userId);
  }

  @Get('billing/wallets/:tenantId')
  getWallet(@Param('tenantId') tenantId: string) {
    return this.admin.getWallet(tenantId);
  }

  @Get('billing/wallets/:tenantId/ledger')
  listLedger(@Param('tenantId') tenantId: string) {
    return this.admin.listLedger(tenantId);
  }

  @Post('billing/topup')
  @Roles('SUPERADMIN')
  topup(@Body() dto: AdminTopupDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admin.topup({
      ...dto,
      createdById: user.userId,
    });
  }

  @Post('billing/adjust')
  @Roles('SUPERADMIN')
  adjust(@Body() dto: AdminAdjustDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admin.adjust({
      ...dto,
      createdById: user.userId,
    });
  }

  @Get('monitoring')
  monitoring() {
    return this.admin.monitoring();
  }

  @Post('provider/smsc/estimate-cost')
  @ApiOperation({
    summary: 'Live SMSC cost for HLR/Ping (provider price, not client tariff)',
  })
  estimateSmscCost(
    @Body() dto: EstimateSmscCostDto,
    @Req() req: Request,
  ) {
    return this.admin.estimateSmscCost({
      checkType: dto.checkType,
      phone: dto.phone,
      correlationId:
        typeof req.headers['x-request-id'] === 'string'
          ? req.headers['x-request-id']
          : undefined,
    });
  }

  @Get('provider/smsc/balance')
  @ApiOperation({ summary: 'Live SMSC account balance' })
  getSmscBalance(@Req() req: Request) {
    return this.admin.getSmscBalance(
      typeof req.headers['x-request-id'] === 'string'
        ? req.headers['x-request-id']
        : undefined,
    );
  }

  @Post('provider/smsc/connectivity-test')
  @ApiOperation({
    summary:
      'No-charge SMSC connectivity test (outbound balance + inbound callback signature)',
  })
  testSmscConnectivity(@Req() req: Request) {
    return this.admin.testSmscConnectivity(
      typeof req.headers['x-request-id'] === 'string'
        ? req.headers['x-request-id']
        : undefined,
    );
  }

  @Get('audit')
  listAudit(@Query() query: AuditListQueryDto) {
    return this.audit.search(query);
  }

  @Get('tariffs')
  @ApiOperation({ summary: 'List tariff plans' })
  listTariffs(@Query() query: PaginationQueryDto) {
    return this.admin.listTariffs(query.page, query.pageSize);
  }

  @Post('tariffs')
  @Roles('SUPERADMIN')
  @ApiOperation({ summary: 'Create tariff plan' })
  createTariff(
    @Body() dto: CreateTariffPlanDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.admin.createTariff(dto, user.userId);
  }

  @Patch('tariffs/:id')
  @Roles('SUPERADMIN')
  @ApiOperation({ summary: 'Update tariff plan' })
  updateTariff(
    @Param('id') id: string,
    @Body() dto: UpdateTariffPlanDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.admin.updateTariff(id, dto, user.userId);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Get platform runtime settings' })
  getSettings() {
    return this.settings.get();
  }

  @Patch('settings')
  @Roles('SUPERADMIN')
  @ApiOperation({ summary: 'Update platform runtime settings (no SMSC secrets)' })
  updateSettings(
    @Body() dto: UpdatePlatformSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.settings.update(dto, user.userId, {
      ip: req.ip,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    });
  }
}
