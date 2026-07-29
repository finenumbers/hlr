import { Prisma } from '@finenumbers/db';

/**
 * Monetary input: decimal string or Prisma.Decimal only.
 * JS `number` is intentionally rejected — it is IEEE-754 binary float.
 */
export type MoneyInput = string | Prisma.Decimal;

const ZERO = new Prisma.Decimal(0);

/** Parse and validate a monetary amount (Decimal arithmetic only). */
export function money(value: MoneyInput): Prisma.Decimal {
  // Runtime guard: public type excludes `number`, but JS callers can still pass floats.
  if (typeof value !== 'string' && !(value instanceof Prisma.Decimal)) {
    throw new Error('Money amounts must be string or Decimal, not number/float');
  }
  let d: Prisma.Decimal;
  try {
    d = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
  } catch {
    throw new Error(`Invalid money amount: ${String(value)}`);
  }
  if (!d.isFinite()) {
    throw new Error(`Invalid money amount: ${String(value)}`);
  }
  return d;
}

/** Exact zero for wallet/ledger writes (never bare JS `0`). */
export function moneyZero(): Prisma.Decimal {
  return ZERO;
}

/**
 * Convert a quantity (phone count, etc.) to Decimal.
 * Only safe integers are accepted — not a monetary float path.
 */
export function moneyFromSafeInteger(value: number, field = 'count'): Prisma.Decimal {
  if (typeof value !== 'number' || !Number.isInteger(value) || !Number.isSafeInteger(value)) {
    throw new Error(`${field} must be a safe integer`);
  }
  return new Prisma.Decimal(value);
}

export function assertPositiveMoney(value: MoneyInput, field = 'amount'): Prisma.Decimal {
  const d = money(value);
  if (d.lte(0)) {
    throw new Error(`${field} must be > 0`);
  }
  return d;
}

export function assertNonNegativeMoney(value: MoneyInput, field = 'amount'): Prisma.Decimal {
  const d = money(value);
  if (d.lt(0)) {
    throw new Error(`${field} must be >= 0`);
  }
  return d;
}

export function moneyToString(value: MoneyInput): string {
  // Prefer Decimal#toString over toFixed() — bare toFixed() rounds to 0 fraction digits.
  return money(value).toString();
}

export function moneyEquals(a: MoneyInput, b: MoneyInput): boolean {
  return money(a).eq(money(b));
}

export function moneyMin(a: MoneyInput, b: MoneyInput): Prisma.Decimal {
  const left = money(a);
  const right = money(b);
  return left.lte(right) ? left : right;
}

export function moneyAdd(...values: MoneyInput[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((acc, v) => acc.plus(money(v)), moneyZero());
}

export function moneySub(a: MoneyInput, b: MoneyInput): Prisma.Decimal {
  return money(a).minus(money(b));
}

export function moneyMul(a: MoneyInput, b: MoneyInput): Prisma.Decimal {
  return money(a).times(money(b));
}
