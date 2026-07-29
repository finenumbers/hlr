import type { Prisma, WalletTransactionType } from '@finenumbers/db';
import { Prisma as PrismaNS } from '@finenumbers/db';

import { money, moneyToString, moneyZero } from './money.js';

export type LedgerProjectionRow = {
  type: WalletTransactionType;
  amount: Prisma.Decimal | string;
  metadata?: Prisma.JsonValue | null;
  /** Optional; used only for stable ordering when folding externally. */
  createdAt?: Date;
  id?: string;
};

export type ProjectedBalances = {
  available: Prisma.Decimal;
  held: Prisma.Decimal;
};

export type ProjectedBalancesView = {
  availableBalance: string;
  heldBalance: string;
};

/**
 * Pure fold of ledger rows → balances.
 * This is the reconstructible source of truth; wallet.available/held are a cache.
 *
 * Rules:
 * - CREDIT          → available += amount
 * - HOLD            → available -= amount, held += amount
 * - RELEASE         → held -= amount, available += amount
 * - DEBIT           → held -= amount              (capture; money leaves the system)
 * - ADJUSTMENT      → available ± amount via metadata.direction ('credit'|'debit')
 */
export function foldLedgerBalances(rows: readonly LedgerProjectionRow[]): ProjectedBalances {
  let available = moneyZero();
  let held = moneyZero();

  for (const row of rows) {
    const amt = money(row.amount instanceof PrismaNS.Decimal ? row.amount : String(row.amount));
    switch (row.type) {
      case 'CREDIT':
        available = available.plus(amt);
        break;
      case 'HOLD':
        available = available.minus(amt);
        held = held.plus(amt);
        break;
      case 'RELEASE':
        held = held.minus(amt);
        available = available.plus(amt);
        break;
      case 'DEBIT':
        held = held.minus(amt);
        break;
      case 'ADJUSTMENT': {
        const direction = readAdjustmentDirection(row.metadata);
        available = direction === 'debit' ? available.minus(amt) : available.plus(amt);
        break;
      }
      default:
        break;
    }
  }

  return { available, held };
}

export function projectedBalancesToView(balances: ProjectedBalances): ProjectedBalancesView {
  return {
    availableBalance: moneyToString(balances.available),
    heldBalance: moneyToString(balances.held),
  };
}

export function balancesMatchCache(
  projected: ProjectedBalances,
  cache: { availableBalance: Prisma.Decimal | string; heldBalance: Prisma.Decimal | string },
): boolean {
  return (
    projected.available.eq(money(cache.availableBalance instanceof PrismaNS.Decimal
      ? cache.availableBalance
      : String(cache.availableBalance))) &&
    projected.held.eq(money(cache.heldBalance instanceof PrismaNS.Decimal
      ? cache.heldBalance
      : String(cache.heldBalance)))
  );
}

function readAdjustmentDirection(metadata: Prisma.JsonValue | null | undefined): 'credit' | 'debit' {
  if (
    metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    'direction' in metadata
  ) {
    const direction = String((metadata as { direction?: unknown }).direction);
    if (direction === 'debit') {
      return 'debit';
    }
  }
  return 'credit';
}
