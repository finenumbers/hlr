import { describe, expect, it } from 'vitest';

import { Prisma } from '@finenumbers/db';

import {
  balancesMatchCache,
  foldLedgerBalances,
  projectedBalancesToView,
} from './ledger-projection.js';

describe('foldLedgerBalances', () => {
  it('reconstructs available/held from a full credit→hold→debit chain', () => {
    const projected = foldLedgerBalances([
      { type: 'CREDIT', amount: '100' },
      { type: 'HOLD', amount: '10' },
      { type: 'HOLD', amount: '5' },
      { type: 'DEBIT', amount: '10' },
      { type: 'RELEASE', amount: '5' },
      { type: 'ADJUSTMENT', amount: '2', metadata: { direction: 'debit' } },
    ]);

    // 100 -10 -5 +5 -2 = 88 available; held: +10 +5 -10 -5 = 0
    expect(projectedBalancesToView(projected)).toEqual({
      availableBalance: '88',
      heldBalance: '0',
    });
  });

  it('keeps open holds visible in held balance', () => {
    const projected = foldLedgerBalances([
      { type: 'CREDIT', amount: '50.5' },
      { type: 'HOLD', amount: '12.25' },
    ]);
    expect(projected.available.eq(new Prisma.Decimal('38.25'))).toBe(true);
    expect(projected.held.eq(new Prisma.Decimal('12.25'))).toBe(true);
  });

  it('matches cache helper', () => {
    const projected = foldLedgerBalances([{ type: 'CREDIT', amount: '1.5' }]);
    expect(
      balancesMatchCache(projected, {
        availableBalance: '1.5',
        heldBalance: '0',
      }),
    ).toBe(true);
    expect(
      balancesMatchCache(projected, {
        availableBalance: '1.4',
        heldBalance: '0',
      }),
    ).toBe(false);
  });
});
