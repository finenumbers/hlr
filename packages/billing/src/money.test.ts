import { describe, expect, it } from 'vitest';

import { Prisma } from '@finenumbers/db';

import {
  assertNonNegativeMoney,
  assertPositiveMoney,
  money,
  moneyAdd,
  moneyEquals,
  moneyFromSafeInteger,
  moneyMin,
  moneyMul,
  moneySub,
  moneyToString,
  moneyZero,
} from './money.js';

describe('money helpers', () => {
  it('parses decimal strings without float drift', () => {
    const a = money('0.1');
    const b = money('0.2');
    expect(moneyToString(moneyAdd(a, b))).toBe('0.3');
    expect(moneyEquals(moneyMul('0.15', moneyFromSafeInteger(3)), '0.45')).toBe(true);
  });

  it('rejects JS number/float as money input', () => {
    expect(() => money(0.1 as unknown as string)).toThrow(/not number\/float/);
    expect(() => assertPositiveMoney('0')).toThrow(/must be > 0/);
    expect(() => assertNonNegativeMoney('-1')).toThrow(/must be >= 0/);
    expect(assertNonNegativeMoney('0').eq(moneyZero())).toBe(true);
  });

  it('supports Prisma.Decimal inputs and exact zero', () => {
    expect(moneyMin(new Prisma.Decimal('1.5'), '2').toString()).toBe('1.5');
    expect(moneySub('10', '3.25').toString()).toBe('6.75');
    expect(moneyZero().isZero()).toBe(true);
  });

  it('accepts only safe integers for quantity conversion', () => {
    expect(moneyFromSafeInteger(12).toString()).toBe('12');
    expect(() => moneyFromSafeInteger(1.5)).toThrow(/safe integer/);
    expect(() => moneyFromSafeInteger(Number.MAX_SAFE_INTEGER + 1)).toThrow(/safe integer/);
  });
});
