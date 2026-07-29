import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import { WalletsService } from './wallets.service';

@ApiTags('wallets')
@ApiBearerAuth()
@Controller('wallets')
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Public()
  @Get('tenant/:tenantId')
  @ApiOperation({ summary: 'Get wallet for tenant (scaffold, no ledger mutations)' })
  getByTenant(@Param('tenantId') tenantId: string) {
    return this.walletsService.getByTenantId(tenantId);
  }
}
