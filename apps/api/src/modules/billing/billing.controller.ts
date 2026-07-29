import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import { NestBillingService } from './billing.service';
import { AdjustDto } from './dto/adjust.dto';
import { EstimateDto } from './dto/estimate.dto';
import { TopupDto } from './dto/topup.dto';

/**
 * Thin admin/BFF surface for money ops. Full admin UI is later (E15).
 * Auth hardening lands with E04/E05; scaffold keeps @Public like sibling modules.
 */
@ApiTags('billing')
@ApiBearerAuth()
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: NestBillingService) {}

  @Public()
  @Post('estimate')
  @ApiOperation({ summary: 'Pre-check tariff estimate for a tenant/checkType' })
  estimate(@Body() dto: EstimateDto) {
    return this.billing.estimate(dto);
  }

  @Public()
  @Post('topup')
  @ApiOperation({ summary: 'Manual wallet top-up (admin flow)' })
  topup(@Body() dto: TopupDto) {
    return this.billing.topupIdempotent(dto);
  }

  @Public()
  @Post('adjust')
  @ApiOperation({ summary: 'Manual wallet adjustment (admin flow)' })
  adjust(@Body() dto: AdjustDto) {
    return this.billing.adjust(dto);
  }

  @Public()
  @Get('wallets/:tenantId/ledger-balance')
  @ApiOperation({
    summary: 'Reconstruct balances from wallet_transactions (ledger source of truth)',
  })
  ledgerBalance(@Param('tenantId') tenantId: string) {
    return this.billing.getBalancesFromLedger(tenantId);
  }

  @Public()
  @Get('wallets/:tenantId/ledger')
  @ApiOperation({ summary: 'List ledger entries in chronological order' })
  listLedger(@Param('tenantId') tenantId: string) {
    return this.billing.listLedger(tenantId);
  }

  @Public()
  @Get('job-items/:jobItemId/ledger')
  @ApiOperation({ summary: 'Ledger movements linked to a job item (check)' })
  listLedgerForJobItem(@Param('jobItemId') jobItemId: string) {
    return this.billing.listLedgerForJobItem(jobItemId);
  }

  @Public()
  @Get('jobs/:jobId/ledger')
  @ApiOperation({ summary: 'Ledger movements linked to all items of a job' })
  listLedgerForJob(@Param('jobId') jobId: string) {
    return this.billing.listLedgerForJob(jobId);
  }

  @Public()
  @Post('wallets/:tenantId/reconcile')
  @ApiOperation({
    summary: 'Compare wallet cache vs ledger fold; optional repair from ledger',
  })
  reconcile(
    @Param('tenantId') tenantId: string,
    @Query('repair') repair?: string,
  ) {
    return this.billing.reconcileWallet(tenantId, repair === 'true' || repair === '1');
  }
}
