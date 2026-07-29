import type { Prisma, PrismaClient, Wallet, WalletTransaction, WalletTransactionType } from '@finenumbers/db';
import { Prisma as PrismaNS } from '@finenumbers/db';

import { BillingError } from './errors.js';
import {
  foldLedgerBalances,
  type ProjectedBalances,
} from './ledger-projection.js';
import {
  assertNonNegativeMoney,
  assertPositiveMoney,
  money,
  moneyToString,
  moneyZero,
} from './money.js';
import type { LedgerEntryView, WalletBalances } from './types.js';

export type DbClient = PrismaClient | Prisma.TransactionClient;

type LockedWalletRow = {
  id: string;
  tenantId: string;
  currency: string;
  availableBalance: Prisma.Decimal;
  heldBalance: Prisma.Decimal;
  version: number;
};

export type CreateLedgerEntryInput = {
  walletId: string;
  tenantId: string;
  type: WalletTransactionType;
  amount: Prisma.Decimal;
  currency: string;
  balanceAfterAvailable: Prisma.Decimal;
  balanceAfterHeld: Prisma.Decimal;
  relatedHoldId?: string | null;
  jobItemId?: string | null;
  idempotencyKey?: string | null;
  description?: string | null;
  metadata?: Prisma.InputJsonValue;
  createdById?: string | null;
};

/**
 * Low-level ledger + wallet cache mutations.
 * All money writes go through this service inside a DB transaction with row lock.
 */
export class LedgerService {
  constructor(private readonly prisma: PrismaClient) {}

  async withWalletLock<T>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient, wallet: LockedWalletRow) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        const wallet = await this.lockWallet(tx, tenantId);
        return fn(tx, wallet);
      },
      {
        // Serializable is safer for money; if contention is high we retry at caller.
        isolationLevel: PrismaNS.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5_000,
        timeout: 15_000,
      },
    );
  }

  async lockWallet(tx: Prisma.TransactionClient, tenantId: string): Promise<LockedWalletRow> {
    const rows = await tx.$queryRaw<LockedWalletRow[]>`
      SELECT id, "tenantId", currency, "availableBalance", "heldBalance", version
      FROM wallets
      WHERE "tenantId" = ${tenantId}
      FOR UPDATE
    `;
    const wallet = rows[0];
    if (!wallet) {
      throw new BillingError('WALLET_NOT_FOUND', `Wallet for tenant ${tenantId} not found`, {
        details: { tenantId },
      });
    }
    return {
      ...wallet,
      availableBalance: money(wallet.availableBalance),
      heldBalance: money(wallet.heldBalance),
    };
  }

  async ensureWallet(
    tenantId: string,
    currency = 'RUB',
    db: DbClient = this.prisma,
  ): Promise<Wallet> {
    const existing = await db.wallet.findUnique({ where: { tenantId } });
    if (existing) {
      return existing;
    }
    try {
      return await db.wallet.create({
        data: {
          tenantId,
          currency,
          availableBalance: moneyZero(),
          heldBalance: moneyZero(),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const again = await db.wallet.findUnique({ where: { tenantId } });
        if (again) {
          return again;
        }
      }
      throw error;
    }
  }

  async findByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
    db: DbClient = this.prisma,
  ): Promise<WalletTransaction | null> {
    return db.walletTransaction.findUnique({
      where: {
        tenantId_idempotencyKey: { tenantId, idempotencyKey },
      },
    });
  }

  async findOpenHoldForJobItem(
    jobItemId: string,
    db: DbClient = this.prisma,
  ): Promise<WalletTransaction | null> {
    const hold = await db.walletTransaction.findFirst({
      where: { jobItemId, type: 'HOLD' },
      orderBy: { createdAt: 'asc' },
    });
    if (!hold) {
      return null;
    }
    const settlement = await db.walletTransaction.findFirst({
      where: {
        relatedHoldId: hold.id,
        type: { in: ['DEBIT', 'RELEASE'] },
      },
    });
    if (settlement) {
      return null;
    }
    return hold;
  }

  async findHoldForJobItem(
    jobItemId: string,
    db: DbClient = this.prisma,
  ): Promise<WalletTransaction | null> {
    return db.walletTransaction.findFirst({
      where: { jobItemId, type: 'HOLD' },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findSettlementsForHold(
    holdId: string,
    db: DbClient = this.prisma,
  ): Promise<WalletTransaction[]> {
    return db.walletTransaction.findMany({
      where: {
        relatedHoldId: holdId,
        type: { in: ['DEBIT', 'RELEASE'] },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createEntry(
    tx: Prisma.TransactionClient,
    input: CreateLedgerEntryInput,
  ): Promise<WalletTransaction> {
    const amount = assertNonNegativeMoney(input.amount, 'amount');
    return tx.walletTransaction.create({
      data: {
        walletId: input.walletId,
        tenantId: input.tenantId,
        type: input.type,
        amount,
        currency: input.currency,
        balanceAfterAvailable: input.balanceAfterAvailable,
        balanceAfterHeld: input.balanceAfterHeld,
        relatedHoldId: input.relatedHoldId ?? null,
        jobItemId: input.jobItemId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        description: input.description ?? null,
        metadata: input.metadata,
        createdById: input.createdById ?? null,
      },
    });
  }

  async applyWalletBalances(
    tx: Prisma.TransactionClient,
    wallet: LockedWalletRow,
    next: { available: Prisma.Decimal; held: Prisma.Decimal },
  ): Promise<LockedWalletRow> {
    const available = money(next.available);
    const held = money(next.held);
    if (available.lt(0) || held.lt(0)) {
      throw new BillingError(
        'NEGATIVE_BALANCE_FORBIDDEN',
        'Wallet balances cannot become negative',
        {
          details: {
            walletId: wallet.id,
            available: moneyToString(available),
            held: moneyToString(held),
          },
        },
      );
    }

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        availableBalance: available,
        heldBalance: held,
        version: { increment: 1 },
      },
    });

    return {
      id: updated.id,
      tenantId: updated.tenantId,
      currency: updated.currency,
      availableBalance: money(updated.availableBalance),
      heldBalance: money(updated.heldBalance),
      version: updated.version,
    };
  }

  /**
   * Apply HOLD: available → held.
   */
  applyHold(wallet: LockedWalletRow, amount: Prisma.Decimal): {
    available: Prisma.Decimal;
    held: Prisma.Decimal;
  } {
    const amt = assertPositiveMoney(amount);
    if (wallet.availableBalance.lt(amt)) {
      throw new BillingError('INSUFFICIENT_FUNDS', 'Insufficient available balance for hold', {
        details: {
          tenantId: wallet.tenantId,
          required: moneyToString(amt),
          available: moneyToString(wallet.availableBalance),
        },
      });
    }
    return {
      available: wallet.availableBalance.minus(amt),
      held: wallet.heldBalance.plus(amt),
    };
  }

  /**
   * Apply DEBIT against held funds (capture). Money leaves the wallet.
   */
  applyDebitFromHeld(wallet: LockedWalletRow, amount: Prisma.Decimal): {
    available: Prisma.Decimal;
    held: Prisma.Decimal;
  } {
    const amt = assertPositiveMoney(amount);
    if (wallet.heldBalance.lt(amt)) {
      throw new BillingError('VALIDATION_FAILED', 'Held balance too low for debit', {
        details: {
          tenantId: wallet.tenantId,
          required: moneyToString(amt),
          held: moneyToString(wallet.heldBalance),
        },
      });
    }
    return {
      available: wallet.availableBalance,
      held: wallet.heldBalance.minus(amt),
    };
  }

  /**
   * Apply RELEASE: held → available.
   */
  applyRelease(wallet: LockedWalletRow, amount: Prisma.Decimal): {
    available: Prisma.Decimal;
    held: Prisma.Decimal;
  } {
    const amt = assertPositiveMoney(amount);
    if (wallet.heldBalance.lt(amt)) {
      throw new BillingError('VALIDATION_FAILED', 'Held balance too low for release', {
        details: {
          tenantId: wallet.tenantId,
          required: moneyToString(amt),
          held: moneyToString(wallet.heldBalance),
        },
      });
    }
    return {
      available: wallet.availableBalance.plus(amt),
      held: wallet.heldBalance.minus(amt),
    };
  }

  /**
   * Apply CREDIT / positive adjustment to available.
   */
  applyCredit(wallet: LockedWalletRow, amount: Prisma.Decimal): {
    available: Prisma.Decimal;
    held: Prisma.Decimal;
  } {
    const amt = assertPositiveMoney(amount);
    return {
      available: wallet.availableBalance.plus(amt),
      held: wallet.heldBalance,
    };
  }

  /**
   * Apply negative adjustment against available (never touches held).
   */
  applyDebitFromAvailable(
    wallet: LockedWalletRow,
    amount: Prisma.Decimal,
    allowNegative = false,
  ): { available: Prisma.Decimal; held: Prisma.Decimal } {
    const amt = assertPositiveMoney(amount);
    const nextAvailable = wallet.availableBalance.minus(amt);
    if (!allowNegative && nextAvailable.lt(0)) {
      throw new BillingError(
        'NEGATIVE_BALANCE_FORBIDDEN',
        'Adjustment would make available balance negative',
        {
          details: {
            tenantId: wallet.tenantId,
            required: moneyToString(amt),
            available: moneyToString(wallet.availableBalance),
          },
        },
      );
    }
    return {
      available: nextAvailable,
      held: wallet.heldBalance,
    };
  }

  toBalances(wallet: LockedWalletRow | Wallet): WalletBalances {
    return {
      walletId: wallet.id,
      tenantId: wallet.tenantId,
      currency: wallet.currency,
      availableBalance: moneyToString(wallet.availableBalance),
      heldBalance: moneyToString(wallet.heldBalance),
      version: wallet.version,
    };
  }

  toEntryView(row: WalletTransaction): LedgerEntryView {
    return {
      id: row.id,
      walletId: row.walletId,
      tenantId: row.tenantId,
      type: row.type,
      amount: moneyToString(row.amount),
      currency: row.currency,
      balanceAfterAvailable:
        row.balanceAfterAvailable === null ? null : moneyToString(row.balanceAfterAvailable),
      balanceAfterHeld:
        row.balanceAfterHeld === null ? null : moneyToString(row.balanceAfterHeld),
      relatedHoldId: row.relatedHoldId,
      jobItemId: row.jobItemId,
      idempotencyKey: row.idempotencyKey,
      description: row.description,
      metadata: row.metadata,
      createdById: row.createdById,
      createdAt: row.createdAt,
    };
  }

  /**
   * Reconstruct balances solely from `wallet_transactions`.
   * Wallet.availableBalance / heldBalance are a cache and must match this fold.
   */
  async projectBalancesFromLedger(
    walletId: string,
    db: DbClient = this.prisma,
  ): Promise<ProjectedBalances> {
    const rows = await db.walletTransaction.findMany({
      where: { walletId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { type: true, amount: true, metadata: true, createdAt: true, id: true },
    });
    return foldLedgerBalances(rows);
  }

  /**
   * List ledger rows in deterministic order (explainability / audit).
   */
  async listLedgerEntries(
    walletId: string,
    db: DbClient = this.prisma,
  ): Promise<LedgerEntryView[]> {
    const rows = await db.walletTransaction.findMany({
      where: { walletId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => this.toEntryView(row));
  }

  async listLedgerEntriesForJobItem(
    jobItemId: string,
    db: DbClient = this.prisma,
  ): Promise<LedgerEntryView[]> {
    const rows = await db.walletTransaction.findMany({
      where: { jobItemId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => this.toEntryView(row));
  }

  async listLedgerEntriesForJob(
    jobId: string,
    db: DbClient = this.prisma,
  ): Promise<LedgerEntryView[]> {
    const items = await db.jobItem.findMany({
      where: { jobId },
      select: { id: true },
    });
    if (items.length === 0) {
      return [];
    }
    const rows = await db.walletTransaction.findMany({
      where: { jobItemId: { in: items.map((i) => i.id) } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => this.toEntryView(row));
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
