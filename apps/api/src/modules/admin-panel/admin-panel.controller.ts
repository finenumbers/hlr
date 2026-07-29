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
import { IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AuditListQueryDto } from '../audit/dto/audit-list-query.dto';
import { AuditService } from '../audit/audit.service';
import { AdminPanelService } from './admin-panel.service';

class UpdateTenantStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED', 'ARCHIVED'] })
  @IsIn(['ACTIVE', 'SUSPENDED', 'ARCHIVED'])
  status!: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
}

class AssignTariffDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  tariffPlanId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d+)?$/)
  hlrPriceOverride?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d+)?$/)
  pingPriceOverride?: string;
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

@ApiTags('admin')
@ApiBearerAuth()
@Roles('SUPERADMIN', 'SUPPORT')
@Controller('admin')
export class AdminPanelController {
  constructor(
    private readonly admin: AdminPanelService,
    private readonly audit: AuditService,
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

  @Post('tenants/:id/tariff')
  @Roles('SUPERADMIN')
  assignTariff(
    @Param('id') id: string,
    @Body() dto: AssignTariffDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.admin.assignTariff(id, dto.tariffPlanId, user.userId, {
      hlrPriceOverride: dto.hlrPriceOverride,
      pingPriceOverride: dto.pingPriceOverride,
    });
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

  @Get('audit')
  listAudit(@Query() query: AuditListQueryDto) {
    return this.audit.search(query);
  }

  @Get('tariffs')
  listTariffs(@Query() query: PaginationQueryDto) {
    return this.admin.listTariffs(query.page, query.pageSize);
  }
}
