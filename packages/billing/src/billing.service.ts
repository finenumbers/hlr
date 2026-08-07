import type { Prisma, PrismaClient } from '@finenumbers/db';

import { BillingError, isBillingError } from './errors.js';
import {
  adjustmentIdempotencyKey,
  debitIdempotencyKey,
  holdIdempotencyKey,
  releaseIdempotencyKey,
  releaseRemainderIdempotencyKey,
  topupIdempotencyKey,
} from './idempotency.js';
import {
  balancesMatchCache,
  projectedBalancesToView,
} from './ledger-projection.js';
import { LedgerService } from './ledger.service.js';
import {
  assertPositiveMoney,
  money,
  moneyFromSafeInteger,
  moneyMin,
  moneySub,
  moneyToString,
  moneyZero,
} from './money.js';
import {
  priceSnapshotFromResolved,
  type PriceSnapshotDto,
} from './price-quote.js';
import { resolveJobItemSettleAction } from './settle-action.js';
import { TariffResolver } from './tariff-resolver.js';
import type {
  AdjustmentResult,
  AuditWriter,
  BillingCheckType,
  BillingLogger,
  CaptureResult,
  CostEstimate,
  CreditResult,
  LedgerEntryView,
  ReleaseResult,
  ReserveResult,
  WalletBalances,
} from './types.js';

const silentLogger: BillingLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const silentAudit: AuditWriter = async () => {};

export type BillingServiceDeps = {
  prisma: PrismaClient;
  logger?: BillingLogger;
  audit?: AuditWriter;
};

/**
 * High-level billing use-cases: estimate, reserve/capture/release, top-up, adjustment.
 * Ledger rows are the source of truth; wallet balances are a transactional cache.
 */
export class BillingService {
  readonly ledger: LedgerService;
  readonly tariffs: TariffResolver;
  private readonly prisma: PrismaClient;
  private readonly logger: BillingLogger;
  private readonly audit: AuditWriter;

  constructor(deps: BillingServiceDeps) {
    this.prisma = deps.prisma;
    this.logger = deps.logger ?? silentLogger;
    this.audit = deps.audit ?? silentAudit;
    this.ledger = new LedgerService(deps.prisma);
    this.tariffs = new TariffResolver(deps.prisma, this.logger);
  }

  async ensureWallet(tenantId: string, currency = 'RUB'): Promise<WalletBalances> {
    const wallet = await this.ledger.ensureWallet(tenantId, currency);
    return this.ledger.toBalances(wallet);
  }

  async getWallet(tenantId: string): Promise<WalletBalances> {
    const wallet = await this.prisma.wallet.findUnique({ where: { tenantId } });
    if (!wallet) {
      throw new BillingError('WALLET_NOT_FOUND', `Wallet for tenant ${tenantId} not found`, {
        details: { tenantId },
      });
    }
    return this.ledger.toBalances(wallet);
  }

  /**
   * Reconstruct balances from `wallet_transactions` only (ledger = source of truth).
   * Does not trust wallet.availableBalance / heldBalance cache fields.
   */
  async getBalancesFromLedger(tenantId: string): Promise<{
    walletId: string;
    tenantId: string;
    currency: string;
    availableBalance: string;
    heldBalance: string;
    entryCount: number;
  }> {
    const wallet = await this.prisma.wallet.findUnique({ where: { tenantId } });
    if (!wallet) {
      throw new BillingError('WALLET_NOT_FOUND', `Wallet for tenant ${tenantId} not found`, {
        details: { tenantId },
      });
    }
    const projected = await this.ledger.projectBalancesFromLedger(wallet.id);
    const entryCount = await this.prisma.walletTransaction.count({
      where: { walletId: wallet.id },
    });
    const view = projectedBalancesToView(projected);
    return {
      walletId: wallet.id,
      tenantId: wallet.tenantId,
      currency: wallet.currency,
      availableBalance: view.availableBalance,
      heldBalance: view.heldBalance,
      entryCount,
    };
  }

  /**
   * Compare wallet cache vs ledger fold. Optionally repair cache from ledger.
   */
  async reconcileWallet(
    tenantId: string,
    options?: { repair?: boolean },
  ): Promise<{
    matched: boolean;
    cache: { availableBalance: string; heldBalance: string };
    ledger: { availableBalance: string; heldBalance: string };
    repaired: boolean;
    entryCount: number;
  }> {
    const wallet = await this.prisma.wallet.findUnique({ where: { tenantId } });
    if (!wallet) {
      throw new BillingError('WALLET_NOT_FOUND', `Wallet for tenant ${tenantId} not found`, {
        details: { tenantId },
      });
    }

    const projected = await this.ledger.projectBalancesFromLedger(wallet.id);
    const matched = balancesMatchCache(projected, wallet);
    const entryCount = await this.prisma.walletTransaction.count({
      where: { walletId: wallet.id },
    });
    const ledgerView = projectedBalancesToView(projected);
    const cacheView = {
      availableBalance: moneyToString(wallet.availableBalance),
      heldBalance: moneyToString(wallet.heldBalance),
    };

    if (matched || !options?.repair) {
      if (!matched) {
        this.logger.warn('billing.wallet.cache_drift', {
          tenantId,
          cache: cacheView,
          ledger: ledgerView,
          entryCount,
        });
      }
      return {
        matched,
        cache: cacheView,
        ledger: ledgerView,
        repaired: false,
        entryCount,
      };
    }

    const repairedWallet = await this.ledger.withWalletLock(tenantId, async (tx, locked) => {
      const again = await this.ledger.projectBalancesFromLedger(locked.id, tx);
      return this.ledger.applyWalletBalances(tx, locked, {
        available: again.available,
        held: again.held,
      });
    });

    this.logger.warn('billing.wallet.cache_repaired_from_ledger', {
      tenantId,
      before: cacheView,
      after: {
        availableBalance: moneyToString(repairedWallet.availableBalance),
        heldBalance: moneyToString(repairedWallet.heldBalance),
      },
      entryCount,
    });

    await this.audit({
      tenantId,
      actorType: 'SYSTEM',
      action: 'billing.wallet.reconcile_repair',
      targetType: 'Wallet',
      targetId: wallet.id,
      metadata: {
        before: cacheView,
        after: {
          availableBalance: moneyToString(repairedWallet.availableBalance),
          heldBalance: moneyToString(repairedWallet.heldBalance),
        },
        entryCount,
      },
    });

    return {
      matched: false,
      cache: cacheView,
      ledger: {
        availableBalance: moneyToString(repairedWallet.availableBalance),
        heldBalance: moneyToString(repairedWallet.heldBalance),
      },
      repaired: true,
      entryCount,
    };
  }

  async listLedger(tenantId: string): Promise<LedgerEntryView[]> {
    const wallet = await this.prisma.wallet.findUnique({ where: { tenantId } });
    if (!wallet) {
      throw new BillingError('WALLET_NOT_FOUND', `Wallet for tenant ${tenantId} not found`, {
        details: { tenantId },
      });
    }
    return this.ledger.listLedgerEntries(wallet.id);
  }

  async listLedgerPage(
    tenantId: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: LedgerEntryView[]; page: number; pageSize: number; total: number }> {
    const wallet = await this.prisma.wallet.findUnique({ where: { tenantId } });
    if (!wallet) {
      throw new BillingError('WALLET_NOT_FOUND', `Wallet for tenant ${tenantId} not found`, {
        details: { tenantId },
      });
    }
    const safePage = Math.max(1, page);
    const safeSize = Math.min(100, Math.max(1, pageSize));
    const { items, total } = await this.ledger.listLedgerEntriesPage(
      wallet.id,
      safePage,
      safeSize,
    );
    return { items, page: safePage, pageSize: safeSize, total };
  }

  /** All money movements for one check (job item). */
  async listLedgerForJobItem(jobItemId: string): Promise<LedgerEntryView[]> {
    return this.ledger.listLedgerEntriesForJobItem(jobItemId);
  }

  /** All money movements for every item in a job. */
  async listLedgerForJob(jobId: string): Promise<LedgerEntryView[]> {
    return this.ledger.listLedgerEntriesForJob(jobId);
  }

  private async resolveJobItemContext(jobItemId: string): Promise<{
    jobId: string;
    phoneE164: string | null;
    checkType: 'HLR' | 'PING';
    unitSellPrice: Prisma.Decimal | null;
    unitProviderCost: Prisma.Decimal | null;
    tariffPlanId: string | null;
    tariffPlanCode: string | null;
    currency: string;
  }> {
    const item = await this.prisma.jobItem.findUnique({
      where: { id: jobItemId },
      select: {
        jobId: true,
        phoneE164: true,
        checkType: true,
        unitSellPrice: true,
        unitProviderCost: true,
        tariffPlanId: true,
        tariffPlanCode: true,
        currency: true,
      },
    });
    if (!item) {
      throw new BillingError('VALIDATION_FAILED', `Job item ${jobItemId} not found`, {
        details: { jobItemId },
      });
    }
    if (item.checkType !== 'HLR' && item.checkType !== 'PING') {
      throw new BillingError('VALIDATION_FAILED', `Job item ${jobItemId} has invalid checkType`, {
        details: { jobItemId, checkType: item.checkType },
      });
    }
    return {
      jobId: item.jobId,
      phoneE164: item.phoneE164,
      checkType: item.checkType,
      unitSellPrice: item.unitSellPrice,
      unitProviderCost: item.unitProviderCost,
      tariffPlanId: item.tariffPlanId,
      tariffPlanCode: item.tariffPlanCode,
      currency: item.currency,
    };
  }

  /**
   * Display/quote helper: billable assignment for one product, or null.
   * Uses the same resolver as estimate/reserve (effective window + active plan).
   */
  async quoteProduct(
    tenantId: string,
    checkType: BillingCheckType,
  ): Promise<PriceSnapshotDto | null> {
    const resolved = await this.tariffs.tryResolveForTenant(tenantId, checkType);
    if (!resolved) {
      return null;
    }
    return priceSnapshotFromResolved(resolved);
  }

  async quoteProducts(tenantId: string): Promise<{
    hlr: PriceSnapshotDto | null;
    ping: PriceSnapshotDto | null;
  }> {
    const [hlr, ping] = await Promise.all([
      this.quoteProduct(tenantId, 'HLR'),
      this.quoteProduct(tenantId, 'PING'),
    ]);
    return { hlr, ping };
  }

  /**
   * Admin-oriented status: distinguish missing assignment vs present-but-not-billable.
   */
  async inspectProductTariff(
    tenantId: string,
    checkType: BillingCheckType,
  ): Promise<{
    status: 'none' | 'active' | 'invalid';
    quote: PriceSnapshotDto | null;
    reasonCode?: string;
    reasonMessage?: string;
  }> {
    const type = checkType === 'PING' ? 'PING' : 'HLR';
    const row = await this.prisma.tenantTariff.findUnique({
      where: { tenantId_checkType: { tenantId, checkType: type } },
      select: { id: true },
    });
    if (!row) {
      return { status: 'none', quote: null };
    }
    try {
      const resolved = await this.tariffs.resolveForTenant(tenantId, type);
      return { status: 'active', quote: priceSnapshotFromResolved(resolved) };
    } catch (error) {
      if (isBillingError(error)) {
        return {
          status: 'invalid',
          quote: null,
          reasonCode: error.code,
          reasonMessage: error.message,
        };
      }
      throw error;
    }
  }

  async inspectProductTariffs(tenantId: string): Promise<{
    hlr: Awaited<ReturnType<BillingService['inspectProductTariff']>>;
    ping: Awaited<ReturnType<BillingService['inspectProductTariff']>>;
  }> {
    const [hlr, ping] = await Promise.all([
      this.inspectProductTariff(tenantId, 'HLR'),
      this.inspectProductTariff(tenantId, 'PING'),
    ]);
    return { hlr, ping };
  }

  estimate(input: {
    tenantId: string;
    checkType: BillingCheckType;
    unitCount: number;
  }): Promise<CostEstimate> {
    return this.tariffs.estimate(input);
  }

  /**
   * Fail-fast pre-check before job creation (best-effort; reserve is authoritative).
   * Uses **live** tariff (correct at accept time, when snapshot is stamped).
   */
  async assertCanAfford(input: {
    tenantId: string;
    checkType: BillingCheckType;
    unitCount: number;
  }): Promise<CostEstimate> {
    const estimate = await this.estimate(input);
    await this.assertWalletCovers(input.tenantId, estimate.estimatedSellTotal);
    return estimate;
  }

  /**
   * Full-batch affordability using a **frozen** unit sell price (CSV after parse).
   * Still gates that the product assignment is live; does not re-price from catalog.
   */
  async assertCanAffordFrozen(input: {
    tenantId: string;
    checkType: BillingCheckType;
    unitCount: number;
    unitSellPrice: string;
  }): Promise<{ required: string; available: string }> {
    if (!Number.isInteger(input.unitCount) || input.unitCount < 1) {
      throw new BillingError('VALIDATION_FAILED', 'unitCount must be a positive integer', {
        details: { unitCount: input.unitCount },
      });
    }
    // Gate only — must still be allowed to run this product.
    await this.tariffs.resolveForTenant(input.tenantId, input.checkType);

    let unit: ReturnType<typeof money>;
    try {
      unit = money(input.unitSellPrice);
    } catch (error) {
      throw new BillingError('INVALID_AMOUNT', 'unitSellPrice snapshot is not valid money', {
        details: { unitSellPrice: input.unitSellPrice },
        cause: error,
      });
    }
    if (unit.lte(0)) {
      throw new BillingError('INVALID_AMOUNT', 'unitSellPrice snapshot must be > 0', {
        details: { unitSellPrice: input.unitSellPrice },
      });
    }

    const required = moneyToString(unit.mul(moneyFromSafeInteger(input.unitCount, 'unitCount')));
    const available = await this.assertWalletCovers(input.tenantId, required);
    return { required, available };
  }

  private async assertWalletCovers(tenantId: string, requiredTotal: string): Promise<string> {
    const wallet = await this.prisma.wallet.findUnique({ where: { tenantId } });
    if (!wallet) {
      throw new BillingError('WALLET_NOT_FOUND', `Wallet for tenant ${tenantId} not found`, {
        details: { tenantId },
      });
    }
    const available = moneyToString(wallet.availableBalance);
    if (money(wallet.availableBalance).lt(money(requiredTotal))) {
      throw new BillingError('INSUFFICIENT_FUNDS', 'Insufficient funds for estimated job cost', {
        details: {
          tenantId,
          required: requiredTotal,
          available,
        },
      });
    }
    return available;
  }

  async reserveForJobItem(input: {
    tenantId: string;
    jobItemId: string;
    checkType: BillingCheckType;
    idempotencyKey?: string;
  }): Promise<ReserveResult> {
    const idemKey = input.idempotencyKey ?? holdIdempotencyKey(input.jobItemId);
    await this.ledger.ensureWallet(input.tenantId);
    const jobContext = await this.resolveJobItemContext(input.jobItemId);

    if (jobContext.checkType !== input.checkType) {
      throw new BillingError(
        'CHECK_TYPE_MISMATCH',
        `Reserve checkType ${input.checkType} does not match job item ${jobContext.checkType}`,
        {
          details: {
            jobItemId: input.jobItemId,
            itemCheckType: jobContext.checkType,
            requestedCheckType: input.checkType,
          },
        },
      );
    }

    const existing = await this.ledger.findByIdempotencyKey(input.tenantId, idemKey);
    if (existing) {
      // HOLD already placed — do not re-price or re-require live tariff.
      const wallet = await this.getWallet(input.tenantId);
      return {
        hold: this.ledger.toEntryView(existing),
        wallet,
        tariff: tariffViewFromHoldOrSnapshot(existing.metadata, jobContext, input.checkType),
        created: false,
      };
    }

    if (jobContext.unitSellPrice === null) {
      throw new BillingError(
        'PRICE_SNAPSHOT_MISSING',
        `Job item ${input.jobItemId} has no unitSellPrice snapshot; refuse live re-price`,
        { details: { jobItemId: input.jobItemId, checkType: input.checkType } },
      );
    }

    // Gate: product must still be assigned. Charge uses job-accept snapshot only.
    const live = await this.tariffs.resolveForTenant(input.tenantId, input.checkType);

    let amount: ReturnType<typeof money>;
    let providerCost: ReturnType<typeof money>;
    try {
      amount = money(jobContext.unitSellPrice);
      if (jobContext.unitProviderCost === null) {
        throw new BillingError(
          'PRICE_SNAPSHOT_MISSING',
          `Job item ${input.jobItemId} has no unitProviderCost snapshot`,
          { details: { jobItemId: input.jobItemId, checkType: input.checkType } },
        );
      }
      providerCost = money(jobContext.unitProviderCost);
    } catch (error) {
      if (error instanceof BillingError) {
        throw error;
      }
      throw new BillingError('INVALID_AMOUNT', 'Job item price snapshot is not valid money', {
        details: {
          jobItemId: input.jobItemId,
          unitSellPrice: String(jobContext.unitSellPrice),
          unitProviderCost: String(jobContext.unitProviderCost),
        },
        cause: error,
      });
    }
    if (amount.lte(0)) {
      throw new BillingError('INVALID_AMOUNT', 'unitSellPrice snapshot must be > 0', {
        details: { jobItemId: input.jobItemId, unitSellPrice: moneyToString(amount) },
      });
    }

    const currency = jobContext.currency || live.currency;
    const sellPrice = amount;
    // Audit ids from snapshot only — never mix with a newer live plan of the same type.
    if (!jobContext.tariffPlanId || !jobContext.tariffPlanCode) {
      throw new BillingError(
        'PRICE_SNAPSHOT_MISSING',
        `Job item ${input.jobItemId} missing tariffPlan snapshot fields`,
        { details: { jobItemId: input.jobItemId, checkType: input.checkType } },
      );
    }
    const tariffPlanId = jobContext.tariffPlanId;
    const tariffPlanCode = jobContext.tariffPlanCode;
    const tariffView: CostEstimate['tariff'] = {
      tariffPlanId,
      tariffPlanCode,
      tenantTariffId: live.tenantTariffId,
      currency,
      checkType: live.checkType === 'PING' ? 'PING' : 'HLR',
      sellPrice: moneyToString(sellPrice),
      providerCost: moneyToString(providerCost),
      source: live.source,
    };

    try {
      return await this.ledger.withWalletLock(input.tenantId, async (tx, locked) => {
        const raced = await this.ledger.findByIdempotencyKey(input.tenantId, idemKey, tx);
        if (raced) {
          return {
            hold: this.ledger.toEntryView(raced),
            wallet: this.ledger.toBalances(locked),
            tariff: tariffViewFromHoldOrSnapshot(raced.metadata, jobContext, input.checkType),
            created: false,
          };
        }

        const next = this.ledger.applyHold(locked, amount);
        const wallet = await this.ledger.applyWalletBalances(tx, locked, next);

        const hold = await this.ledger.createEntry(tx, {
          walletId: wallet.id,
          tenantId: input.tenantId,
          type: 'HOLD',
          amount,
          currency,
          balanceAfterAvailable: wallet.availableBalance,
          balanceAfterHeld: wallet.heldBalance,
          jobItemId: input.jobItemId,
          idempotencyKey: idemKey,
          description: `Reserve for ${live.checkType} check`,
          metadata: {
            jobId: jobContext.jobId,
            jobItemId: input.jobItemId,
            phoneE164: jobContext.phoneE164,
            checkType: live.checkType,
            sellPrice: moneyToString(sellPrice),
            providerCost: moneyToString(providerCost),
            tariffPlanId,
            tariffPlanCode,
            tenantTariffId: live.tenantTariffId,
            source: live.source,
            priceSource: 'job_snapshot',
          },
        });

        await tx.jobItem.update({
          where: { id: input.jobItemId },
          data: {
            estimatedCost: amount,
            currency,
          },
        });

        this.logger.info('billing.reserve.created', {
          tenantId: input.tenantId,
          jobItemId: input.jobItemId,
          amount: moneyToString(amount),
          holdId: hold.id,
          priceSource: 'job_snapshot',
        });

        return {
          hold: this.ledger.toEntryView(hold),
          wallet: this.ledger.toBalances(wallet),
          tariff: tariffView,
          created: true,
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const again = await this.ledger.findByIdempotencyKey(input.tenantId, idemKey);
        if (again) {
          const wallet = await this.getWallet(input.tenantId);
          return {
            hold: this.ledger.toEntryView(again),
            wallet,
            tariff: tariffViewFromHoldOrSnapshot(again.metadata, jobContext, input.checkType),
            created: false,
          };
        }
      }
      throw error;
    }
  }

  /**
   * Capture (DEBIT) against the item HOLD.
   * Policy B default: charge full reserved sell price.
   * If `chargeAmount` < hold, debit charge and RELEASE the remainder (partial return).
   */
  async captureForJobItem(input: {
    tenantId: string;
    jobItemId: string;
    /** Optional actual charge; defaults to full hold (Policy B). Must be <= hold. */
    chargeAmount?: string;
    idempotencyKey?: string;
  }): Promise<CaptureResult> {
    const debitKey = input.idempotencyKey ?? debitIdempotencyKey(input.jobItemId);
    const remainderKey = releaseRemainderIdempotencyKey(input.jobItemId);

    const existingDebit = await this.ledger.findByIdempotencyKey(input.tenantId, debitKey);
    if (existingDebit) {
      const remainder = await this.ledger.findByIdempotencyKey(input.tenantId, remainderKey);
      const wallet = await this.getWallet(input.tenantId);
      return {
        debit: this.ledger.toEntryView(existingDebit),
        release: remainder ? this.ledger.toEntryView(remainder) : null,
        wallet,
        chargedAmount: moneyToString(existingDebit.amount),
        releasedAmount: remainder ? moneyToString(remainder.amount) : '0',
        created: false,
      };
    }

    try {
      return await this.ledger.withWalletLock(input.tenantId, async (tx, locked) => {
        const racedDebit = await this.ledger.findByIdempotencyKey(input.tenantId, debitKey, tx);
        if (racedDebit) {
          const remainder = await this.ledger.findByIdempotencyKey(
            input.tenantId,
            remainderKey,
            tx,
          );
          return {
            debit: this.ledger.toEntryView(racedDebit),
            release: remainder ? this.ledger.toEntryView(remainder) : null,
            wallet: this.ledger.toBalances(locked),
            chargedAmount: moneyToString(racedDebit.amount),
            releasedAmount: remainder ? moneyToString(remainder.amount) : '0',
            created: false,
          };
        }

        const hold = await this.ledger.findHoldForJobItem(input.jobItemId, tx);
        if (!hold) {
          this.logger.warn('billing.capture.no_hold', {
            tenantId: input.tenantId,
            jobItemId: input.jobItemId,
          });
          return {
            debit: null,
            release: null,
            wallet: this.ledger.toBalances(locked),
            chargedAmount: '0',
            releasedAmount: '0',
            created: false,
          };
        }

        const settlements = await this.ledger.findSettlementsForHold(hold.id, tx);
        if (settlements.length > 0) {
          const debit = settlements.find((s) => s.type === 'DEBIT') ?? null;
          const release = settlements.find((s) => s.type === 'RELEASE') ?? null;
          return {
            debit: debit ? this.ledger.toEntryView(debit) : null,
            release: release ? this.ledger.toEntryView(release) : null,
            wallet: this.ledger.toBalances(locked),
            chargedAmount: debit ? moneyToString(debit.amount) : '0',
            releasedAmount: release ? moneyToString(release.amount) : '0',
            created: false,
          };
        }

        const holdAmount = money(hold.amount);
        let charge = holdAmount;
        if (input.chargeAmount !== undefined) {
          charge = assertPositiveMoney(input.chargeAmount, 'chargeAmount');
          if (charge.gt(holdAmount)) {
            throw new BillingError(
              'VALIDATION_FAILED',
              'chargeAmount cannot exceed reserved hold amount',
              {
                details: {
                  chargeAmount: moneyToString(charge),
                  holdAmount: moneyToString(holdAmount),
                },
              },
            );
          }
        }
        charge = moneyMin(charge, holdAmount);
        const remainder = moneySub(holdAmount, charge);

        let wallet = locked;
        let debitRow = null;
        let releaseRow = null;

        if (charge.gt(0)) {
          const afterDebit = this.ledger.applyDebitFromHeld(wallet, charge);
          wallet = await this.ledger.applyWalletBalances(tx, wallet, afterDebit);
          debitRow = await this.ledger.createEntry(tx, {
            walletId: wallet.id,
            tenantId: input.tenantId,
            type: 'DEBIT',
            amount: charge,
            currency: hold.currency,
            balanceAfterAvailable: wallet.availableBalance,
            balanceAfterHeld: wallet.heldBalance,
            relatedHoldId: hold.id,
            jobItemId: input.jobItemId,
            idempotencyKey: debitKey,
            description: 'Capture reserved funds',
            metadata: {
              ...jobLinkFromHoldMetadata(hold.metadata),
              holdId: hold.id,
              holdAmount: moneyToString(holdAmount),
              chargeAmount: moneyToString(charge),
            },
          });
        }

        if (remainder.gt(0)) {
          const afterRelease = this.ledger.applyRelease(wallet, remainder);
          wallet = await this.ledger.applyWalletBalances(tx, wallet, afterRelease);
          releaseRow = await this.ledger.createEntry(tx, {
            walletId: wallet.id,
            tenantId: input.tenantId,
            type: 'RELEASE',
            amount: remainder,
            currency: hold.currency,
            balanceAfterAvailable: wallet.availableBalance,
            balanceAfterHeld: wallet.heldBalance,
            relatedHoldId: hold.id,
            jobItemId: input.jobItemId,
            idempotencyKey: remainderKey,
            description: 'Release unused reserved funds after partial capture',
            metadata: {
              ...jobLinkFromHoldMetadata(hold.metadata),
              holdId: hold.id,
              reason: 'partial_capture_remainder',
            },
          });
        }

        await tx.jobItem.update({
          where: { id: input.jobItemId },
          data: {
            actualCost: charge,
            currency: hold.currency,
          },
        });

        this.logger.info('billing.capture.created', {
          tenantId: input.tenantId,
          jobItemId: input.jobItemId,
          chargedAmount: moneyToString(charge),
          releasedAmount: moneyToString(remainder),
        });

        return {
          debit: debitRow ? this.ledger.toEntryView(debitRow) : null,
          release: releaseRow ? this.ledger.toEntryView(releaseRow) : null,
          wallet: this.ledger.toBalances(wallet),
          chargedAmount: moneyToString(charge),
          releasedAmount: moneyToString(remainder),
          created: true,
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const again = await this.ledger.findByIdempotencyKey(input.tenantId, debitKey);
        if (again) {
          const remainder = await this.ledger.findByIdempotencyKey(input.tenantId, remainderKey);
          const wallet = await this.getWallet(input.tenantId);
          return {
            debit: this.ledger.toEntryView(again),
            release: remainder ? this.ledger.toEntryView(remainder) : null,
            wallet,
            chargedAmount: moneyToString(again.amount),
            releasedAmount: remainder ? moneyToString(remainder.amount) : '0',
            created: false,
          };
        }
      }
      throw error;
    }
  }

  /**
   * Full release of an open HOLD (send-fail / timeout / cancel).
   */
  async releaseForJobItem(input: {
    tenantId: string;
    jobItemId: string;
    idempotencyKey?: string;
    reason?: string;
  }): Promise<ReleaseResult> {
    const releaseKey = input.idempotencyKey ?? releaseIdempotencyKey(input.jobItemId);

    const existing = await this.ledger.findByIdempotencyKey(input.tenantId, releaseKey);
    if (existing) {
      const wallet = await this.getWallet(input.tenantId);
      return {
        release: this.ledger.toEntryView(existing),
        wallet,
        releasedAmount: moneyToString(existing.amount),
        created: false,
      };
    }

    // Already captured (or remainder-released after capture) — treat as idempotent no-op.
    const debit = await this.ledger.findByIdempotencyKey(
      input.tenantId,
      debitIdempotencyKey(input.jobItemId),
    );
    if (debit) {
      const wallet = await this.getWallet(input.tenantId);
      this.logger.debug('billing.release.skipped_already_captured', {
        tenantId: input.tenantId,
        jobItemId: input.jobItemId,
      });
      return {
        release: null,
        wallet,
        releasedAmount: '0',
        created: false,
      };
    }

    try {
      return await this.ledger.withWalletLock(input.tenantId, async (tx, locked) => {
        const raced = await this.ledger.findByIdempotencyKey(input.tenantId, releaseKey, tx);
        if (raced) {
          return {
            release: this.ledger.toEntryView(raced),
            wallet: this.ledger.toBalances(locked),
            releasedAmount: moneyToString(raced.amount),
            created: false,
          };
        }

        // Re-check capture under lock (callback+poll race).
        const captured = await this.ledger.findByIdempotencyKey(
          input.tenantId,
          debitIdempotencyKey(input.jobItemId),
          tx,
        );
        if (captured) {
          return {
            release: null,
            wallet: this.ledger.toBalances(locked),
            releasedAmount: '0',
            created: false,
          };
        }

        const hold = await this.ledger.findOpenHoldForJobItem(input.jobItemId, tx);
        if (!hold) {
          this.logger.warn('billing.release.no_open_hold', {
            tenantId: input.tenantId,
            jobItemId: input.jobItemId,
          });
          return {
            release: null,
            wallet: this.ledger.toBalances(locked),
            releasedAmount: '0',
            created: false,
          };
        }

        const amount = money(hold.amount);
        const next = this.ledger.applyRelease(locked, amount);
        const wallet = await this.ledger.applyWalletBalances(tx, locked, next);
        const release = await this.ledger.createEntry(tx, {
          walletId: wallet.id,
          tenantId: input.tenantId,
          type: 'RELEASE',
          amount,
          currency: hold.currency,
          balanceAfterAvailable: wallet.availableBalance,
          balanceAfterHeld: wallet.heldBalance,
          relatedHoldId: hold.id,
          jobItemId: input.jobItemId,
          idempotencyKey: releaseKey,
        description: input.reason ?? 'Release reserved funds',
        metadata: {
          ...jobLinkFromHoldMetadata(hold.metadata),
          holdId: hold.id,
          reason: input.reason ?? 'release',
        },
      });

        await tx.jobItem.update({
          where: { id: input.jobItemId },
          data: { actualCost: moneyZero() },
        });

        this.logger.info('billing.release.created', {
          tenantId: input.tenantId,
          jobItemId: input.jobItemId,
          amount: moneyToString(amount),
        });

        return {
          release: this.ledger.toEntryView(release),
          wallet: this.ledger.toBalances(wallet),
          releasedAmount: moneyToString(amount),
          created: true,
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const again = await this.ledger.findByIdempotencyKey(input.tenantId, releaseKey);
        if (again) {
          const wallet = await this.getWallet(input.tenantId);
          return {
            release: this.ledger.toEntryView(again),
            wallet,
            releasedAmount: moneyToString(again.amount),
            created: false,
          };
        }
      }
      throw error;
    }
  }

  async topup(input: {
    tenantId: string;
    amount: string;
    description?: string;
    createdById: string;
    idempotencyKey: string;
    currency?: string;
  }): Promise<CreditResult> {
    let amount;
    try {
      amount = assertPositiveMoney(input.amount, 'amount');
    } catch (error) {
      throw new BillingError('INVALID_AMOUNT', 'Top-up amount must be > 0', { cause: error });
    }

    const idemKey = topupIdempotencyKey(input.tenantId, input.idempotencyKey);
    await this.ledger.ensureWallet(input.tenantId, input.currency ?? 'RUB');

    const existing = await this.ledger.findByIdempotencyKey(input.tenantId, idemKey);
    if (existing) {
      const wallet = await this.getWallet(input.tenantId);
      return {
        credit: this.ledger.toEntryView(existing),
        wallet,
        created: false,
      };
    }

    let result: CreditResult;
    try {
      result = await this.ledger.withWalletLock(input.tenantId, async (tx, locked) => {
        const raced = await this.ledger.findByIdempotencyKey(input.tenantId, idemKey, tx);
        if (raced) {
          return {
            credit: this.ledger.toEntryView(raced),
            wallet: this.ledger.toBalances(locked),
            created: false,
          };
        }

        const next = this.ledger.applyCredit(locked, amount);
        const wallet = await this.ledger.applyWalletBalances(tx, locked, next);
        const credit = await this.ledger.createEntry(tx, {
          walletId: wallet.id,
          tenantId: input.tenantId,
          type: 'CREDIT',
          amount,
          currency: locked.currency,
          balanceAfterAvailable: wallet.availableBalance,
          balanceAfterHeld: wallet.heldBalance,
          idempotencyKey: idemKey,
          description: input.description ?? 'Manual top-up',
          createdById: input.createdById,
          metadata: { kind: 'manual_topup' },
        });

        return {
          credit: this.ledger.toEntryView(credit),
          wallet: this.ledger.toBalances(wallet),
          created: true,
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const again = await this.ledger.findByIdempotencyKey(input.tenantId, idemKey);
        if (again) {
          const wallet = await this.getWallet(input.tenantId);
          result = {
            credit: this.ledger.toEntryView(again),
            wallet,
            created: false,
          };
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }

    if (result.created) {
      await this.audit({
        tenantId: input.tenantId,
        actorType: 'USER',
        actorUserId: input.createdById,
        action: 'billing.wallet.topup',
        targetType: 'Wallet',
        targetId: result.wallet.walletId,
        metadata: {
          amount: moneyToString(amount),
          currency: result.wallet.currency,
          ledgerEntryId: result.credit.id,
          idempotencyKey: idemKey,
        },
      });
    }

    return result;
  }

  async adjust(input: {
    tenantId: string;
    amount: string;
    direction: 'credit' | 'debit';
    description?: string;
    createdById: string;
    idempotencyKey: string;
    allowNegative?: boolean;
  }): Promise<AdjustmentResult> {
    let amount;
    try {
      amount = assertPositiveMoney(input.amount, 'amount');
    } catch (error) {
      throw new BillingError('INVALID_AMOUNT', 'Adjustment amount must be > 0', { cause: error });
    }

    const idemKey = adjustmentIdempotencyKey(input.tenantId, input.idempotencyKey);
    await this.ledger.ensureWallet(input.tenantId);

    const existing = await this.ledger.findByIdempotencyKey(input.tenantId, idemKey);
    if (existing) {
      const wallet = await this.getWallet(input.tenantId);
      return {
        adjustment: this.ledger.toEntryView(existing),
        wallet,
        created: false,
      };
    }

    let result: AdjustmentResult;
    try {
      result = await this.ledger.withWalletLock(input.tenantId, async (tx, locked) => {
        const raced = await this.ledger.findByIdempotencyKey(input.tenantId, idemKey, tx);
        if (raced) {
          return {
            adjustment: this.ledger.toEntryView(raced),
            wallet: this.ledger.toBalances(locked),
            created: false,
          };
        }

        const next =
          input.direction === 'credit'
            ? this.ledger.applyCredit(locked, amount)
            : this.ledger.applyDebitFromAvailable(locked, amount, input.allowNegative ?? false);

        const wallet = await this.ledger.applyWalletBalances(tx, locked, next);
        const adjustment = await this.ledger.createEntry(tx, {
          walletId: wallet.id,
          tenantId: input.tenantId,
          type: 'ADJUSTMENT',
          amount,
          currency: locked.currency,
          balanceAfterAvailable: wallet.availableBalance,
          balanceAfterHeld: wallet.heldBalance,
          idempotencyKey: idemKey,
          description: input.description ?? `Manual adjustment (${input.direction})`,
          createdById: input.createdById,
          metadata: {
            kind: 'manual_adjustment',
            direction: input.direction,
          },
        });

        return {
          adjustment: this.ledger.toEntryView(adjustment),
          wallet: this.ledger.toBalances(wallet),
          created: true,
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const again = await this.ledger.findByIdempotencyKey(input.tenantId, idemKey);
        if (again) {
          const wallet = await this.getWallet(input.tenantId);
          result = {
            adjustment: this.ledger.toEntryView(again),
            wallet,
            created: false,
          };
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }

    if (result.created) {
      await this.audit({
        tenantId: input.tenantId,
        actorType: 'USER',
        actorUserId: input.createdById,
        action: 'billing.wallet.adjustment',
        targetType: 'Wallet',
        targetId: result.wallet.walletId,
        metadata: {
          amount: moneyToString(amount),
          direction: input.direction,
          currency: result.wallet.currency,
          ledgerEntryId: result.adjustment.id,
          idempotencyKey: idemKey,
        },
      });
    }

    return result;
  }

  /**
   * Terminal job items that still have an open HOLD (no DEBIT/RELEASE).
   * Used by reconcile open-hold reaper.
   */
  async listTerminalJobsWithOpenHolds(limit: number): Promise<
    Array<{ jobId: string; tenantId: string }>
  > {
    const rows = await this.prisma.$queryRaw<
      Array<{ jobId: string; tenantId: string }>
    >`
      SELECT DISTINCT ji."jobId" AS "jobId", ji."tenantId" AS "tenantId"
      FROM wallet_transactions h
      INNER JOIN job_items ji ON ji.id = h."jobItemId"
      WHERE h.type = 'HOLD'
        AND ji.status IN ('COMPLETED', 'FAILED')
        AND NOT EXISTS (
          SELECT 1
          FROM wallet_transactions s
          WHERE s."relatedHoldId" = h.id
            AND s.type IN ('DEBIT', 'RELEASE')
        )
      LIMIT ${limit}
    `;
    return rows;
  }

  /**
   * Settle open HOLDs for terminal items (idempotent).
   * Honors JobItem.billingAction: CAPTURE vs RELEASE (Policy B).
   * Legacy null action uses resolveJobItemSettleAction heuristic.
   */
  async settleUnsettledHoldsForJob(jobId: string): Promise<{
    attempted: number;
    captured: number;
    released: number;
  }> {
    const items = await this.prisma.jobItem.findMany({
      where: {
        jobId,
        status: { in: ['COMPLETED', 'FAILED'] },
      },
      select: {
        id: true,
        tenantId: true,
        status: true,
        billingAction: true,
        resultStatus: true,
      },
    });

    let captured = 0;
    let released = 0;
    for (const item of items) {
      try {
        const open = await this.ledger.findOpenHoldForJobItem(item.id);
        if (!open) {
          continue;
        }
        const action = resolveJobItemSettleAction(item);
        if (action === 'release') {
          const result = await this.releaseForJobItem({
            tenantId: item.tenantId,
            jobItemId: item.id,
            reason: 'finalize_settle_release',
          });
          if (result.created || result.releasedAmount !== '0') {
            released += 1;
          }
          continue;
        }
        const result = await this.captureForJobItem({
          tenantId: item.tenantId,
          jobItemId: item.id,
        });
        if (result.created || (result.debit && result.chargedAmount !== '0')) {
          captured += 1;
        }
      } catch (error) {
        this.logger.error('billing.settle_holds.item_failed', {
          jobId,
          jobItemId: item.id,
          tenantId: item.tenantId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { attempted: items.length, captured, released };
  }

  /**
   * Sum actualCost of job items and persist on Job (called from job-finalized hook).
   */
  async reconcileJobCosts(jobId: string): Promise<{ estimatedCost: string; actualCost: string }> {
    const items = await this.prisma.jobItem.findMany({
      where: { jobId },
      select: { estimatedCost: true, actualCost: true },
    });

    let estimated = moneyZero();
    let actual = moneyZero();
    for (const item of items) {
      if (item.estimatedCost !== null) {
        estimated = estimated.plus(money(item.estimatedCost));
      }
      if (item.actualCost !== null) {
        actual = actual.plus(money(item.actualCost));
      }
    }

    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        estimatedCost: estimated,
        actualCost: actual,
      },
    });

    return {
      estimatedCost: moneyToString(estimated),
      actualCost: moneyToString(actual),
    };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

function tariffViewFromHoldOrSnapshot(
  metadata: unknown,
  snapshot: {
    unitSellPrice: Prisma.Decimal | null;
    unitProviderCost: Prisma.Decimal | null;
    tariffPlanId: string | null;
    tariffPlanCode: string | null;
    currency: string;
  },
  checkType: BillingCheckType,
): CostEstimate['tariff'] {
  const meta =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  const sell =
    typeof meta.sellPrice === 'string'
      ? meta.sellPrice
      : snapshot.unitSellPrice !== null
        ? moneyToString(snapshot.unitSellPrice)
        : '0';
  const provider =
    typeof meta.providerCost === 'string'
      ? meta.providerCost
      : snapshot.unitProviderCost !== null
        ? moneyToString(snapshot.unitProviderCost)
        : '0';
  return {
    tariffPlanId:
      typeof meta.tariffPlanId === 'string'
        ? meta.tariffPlanId
        : (snapshot.tariffPlanId ?? ''),
    tariffPlanCode:
      typeof meta.tariffPlanCode === 'string'
        ? meta.tariffPlanCode
        : (snapshot.tariffPlanCode ?? ''),
    tenantTariffId: typeof meta.tenantTariffId === 'string' ? meta.tenantTariffId : null,
    currency:
      typeof meta.currency === 'string'
        ? meta.currency
        : snapshot.currency || 'RUB',
    checkType:
      meta.checkType === 'HLR' || meta.checkType === 'PING' ? meta.checkType : checkType,
    sellPrice: sell,
    providerCost: provider,
    source: meta.source === 'tenant_override' ? 'tenant_override' : 'tenant_plan',
  };
}

/** Copy job linkage fields from HOLD metadata onto DEBIT/RELEASE rows. */
function jobLinkFromHoldMetadata(
  metadata: unknown,
): { jobId?: string; jobItemId?: string; phoneE164?: string; checkType?: string } {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }
  const m = metadata as Record<string, unknown>;
  return {
    ...(typeof m.jobId === 'string' ? { jobId: m.jobId } : {}),
    ...(typeof m.jobItemId === 'string' ? { jobItemId: m.jobItemId } : {}),
    ...(typeof m.phoneE164 === 'string' ? { phoneE164: m.phoneE164 } : {}),
    ...(typeof m.checkType === 'string' ? { checkType: m.checkType } : {}),
  };
}
