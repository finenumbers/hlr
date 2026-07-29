import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../../common/decorators/roles.decorator';
import { NestBillingService } from './billing.service';
import { AdjustDto } from './dto/adjust.dto';
import { EstimateDto } from './dto/estimate.dto';
import { TopupDto } from './dto/topup.dto';

/**
 * Internal platform money ops (session auth + SUPERADMIN).
 * Prefer `/admin/billing/*` for UI; this controller is for ops/reconcile tooling.
 * Intentionally NOT @Public — unauthenticated money/estimate was a scaffold footgun.
 */
@ApiTags('billing')
@ApiBearerAuth()
@Roles('SUPERADMIN')
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: NestBillingService) {}

  @Post('estimate')
  @ApiOperation({ summary: 'Pre-check tariff estimate for a tenant/checkType' })
  estimate(@Body() dto: EstimateDto) {
    return this.billing.estimate(dto);
  }

  @Post('topup')
  @ApiOperation({ summary: 'Manual wallet top-up (admin flow)' })
  topup(@Body() dto: TopupDto) {
    return this.billing.topupIdempotent(dto);
  }

  @Post('adjust')
  @ApiOperation({ summary: 'Manual wallet adjustment (admin flow)' })
  adjust(@Body() dto: AdjustDto) {
    return this.billing.adjust(dto);
  }

  @Get('wallets/:tenantId/ledger-balance')
  @ApiOperation({
    summary: 'Reconstruct balances from wallet_transactions (ledger source of truth)',
  })
  ledgerBalance(@Param('tenantId') tenantId: string) {
    return this.billing.getBalancesFromLedger(tenantId);
  }

  @Get('wallets/:tenantId/ledger')
  @ApiOperation({ summary: 'List ledger entries in chronological order' })
  listLedger(@Param('tenantId') tenantId: string) {
    return this.billing.listLedger(tenantId);
  }

  @Get('job-items/:jobItemId/ledger')
  @ApiOperation({ summary: 'Ledger movements linked to a job item (check)' })
  listLedgerForJobItem(@Param('jobItemId') jobItemId: string) {
    return this.billing.listLedgerForJobItem(jobItemId);
  }

  @Get('jobs/:jobId/ledger')
  @ApiOperation({ summary: 'Ledger movements linked to all items of a job' })
  listLedgerForJob(@Param('jobId') jobId: string) {
    return this.billing.listLedgerForJob(jobId);
  }

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
