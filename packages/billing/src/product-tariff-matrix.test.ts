/**
 * Acceptance matrix: four tenant product-assignment states × billing surfaces.
 *
 * States: none | hlr-only | ping-only | both
 * Surfaces: quote/inspect (cabinet+admin availability), estimate, assertCanAfford,
 *           reserve, finalize (capture), assertCanAffordFrozen
 *
 * UI/public API wiring is covered separately; this file locks the commercial core.
 */
import { describe, expect, it } from 'vitest';

import { Prisma, type PrismaClient } from '@finenumbers/db';

import { BillingService } from './billing.service.js';
import { FakeBillingPrisma } from './test-fake-prisma.js';

type State = 'none' | 'hlr-only' | 'ping-only' | 'both';

function createBilling(db: FakeBillingPrisma): BillingService {
  return new BillingService({ prisma: db as unknown as PrismaClient });
}

function setupState(state: State): {
  db: FakeBillingPrisma;
  billing: BillingService;
  tenantId: string;
  hlrPlanId: string | null;
  pingPlanId: string | null;
} {
  const db = new FakeBillingPrisma();
  const tenantId = `tenant-${state}`;
  db.seedWallet(tenantId, '100');
  let hlrPlanId: string | null = null;
  let pingPlanId: string | null = null;

  if (state === 'hlr-only' || state === 'both') {
    hlrPlanId = db.seedAssignedPlan(tenantId, {
      code: 'hlr-std',
      sellPrice: '1.500000',
      providerCost: '0.400000',
      checkType: 'HLR',
    }).id;
  }
  if (state === 'ping-only' || state === 'both') {
    pingPlanId = db.seedAssignedPlan(tenantId, {
      code: 'ping-std',
      sellPrice: '2.500000',
      providerCost: '0.800000',
      checkType: 'PING',
    }).id;
  }

  return { db, billing: createBilling(db), tenantId, hlrPlanId, pingPlanId };
}

async function expectTariffBlocked(
  billing: BillingService,
  tenantId: string,
  checkType: 'HLR' | 'PING',
): Promise<void> {
  await expect(billing.estimate({ tenantId, checkType, unitCount: 1 })).rejects.toMatchObject({
    code: 'TARIFF_NOT_CONFIGURED',
  });
  await expect(
    billing.assertCanAfford({ tenantId, checkType, unitCount: 1 }),
  ).rejects.toMatchObject({ code: 'TARIFF_NOT_CONFIGURED' });
  await expect(
    billing.assertCanAffordFrozen({
      tenantId,
      checkType,
      unitCount: 1,
      unitSellPrice: '1.5',
    }),
  ).rejects.toMatchObject({ code: 'TARIFF_NOT_CONFIGURED' });
}

async function expectProductLive(
  billing: BillingService,
  db: FakeBillingPrisma,
  tenantId: string,
  checkType: 'HLR' | 'PING',
  unitSellPrice: string,
): Promise<void> {
  const estimate = await billing.estimate({ tenantId, checkType, unitCount: 2 });
  expect(estimate.unitSellPrice).toBe(unitSellPrice);
  expect(estimate.estimatedSellTotal).toBe(
    new Prisma.Decimal(unitSellPrice).mul(2).toString(),
  );

  const afford = await billing.assertCanAfford({ tenantId, checkType, unitCount: 1 });
  expect(afford.unitSellPrice).toBe(unitSellPrice);

  const frozen = await billing.assertCanAffordFrozen({
    tenantId,
    checkType,
    unitCount: 2,
    unitSellPrice: '9.99',
  });
  expect(frozen.required).toBe('19.98');

  const item = db.seedJobItem(tenantId, undefined, { checkType });
  const reserved = await billing.reserveForJobItem({
    tenantId,
    jobItemId: item.id,
    checkType,
  });
  expect(reserved.created).toBe(true);
  expect(reserved.hold.amount).toBe(unitSellPrice);
  expect(reserved.tariff.checkType).toBe(checkType);

  const capture = await billing.captureForJobItem({ tenantId, jobItemId: item.id });
  expect(capture.chargedAmount).toBe(unitSellPrice);
  expect(capture.debit?.type).toBe('DEBIT');
}

describe('product tariff acceptance matrix (4 states)', () => {
  it.each([
    {
      state: 'none' as const,
      expectHlr: false,
      expectPing: false,
    },
    {
      state: 'hlr-only' as const,
      expectHlr: true,
      expectPing: false,
    },
    {
      state: 'ping-only' as const,
      expectHlr: false,
      expectPing: true,
    },
    {
      state: 'both' as const,
      expectHlr: true,
      expectPing: true,
    },
  ])(
    'state=$state: quote/inspect/estimate/afford/reserve/finalize',
    async ({ state, expectHlr, expectPing }) => {
      const { db, billing, tenantId, hlrPlanId, pingPlanId } = setupState(state);

      const quotes = await billing.quoteProducts(tenantId);
      expect(Boolean(quotes.hlr)).toBe(expectHlr);
      expect(Boolean(quotes.ping)).toBe(expectPing);
      if (expectHlr) {
        expect(quotes.hlr?.unitSellPrice).toBe('1.5');
        expect(quotes.hlr?.tariffPlanId).toBe(hlrPlanId);
        expect(quotes.hlr?.checkType).toBe('HLR');
      }
      if (expectPing) {
        expect(quotes.ping?.unitSellPrice).toBe('2.5');
        expect(quotes.ping?.tariffPlanId).toBe(pingPlanId);
        expect(quotes.ping?.checkType).toBe('PING');
      }

      const inspected = await billing.inspectProductTariffs(tenantId);
      expect(inspected.hlr.status).toBe(expectHlr ? 'active' : 'none');
      expect(inspected.ping.status).toBe(expectPing ? 'active' : 'none');

      if (expectHlr) {
        await expectProductLive(billing, db, tenantId, 'HLR', '1.5');
      } else {
        await expectTariffBlocked(billing, tenantId, 'HLR');
      }

      if (expectPing) {
        await expectProductLive(billing, db, tenantId, 'PING', '2.5');
      } else {
        await expectTariffBlocked(billing, tenantId, 'PING');
      }
    },
  );

  it('hlr-only never falls back to a Ping plan price (regression)', async () => {
    const { db, billing, tenantId } = setupState('hlr-only');
    // Orphan Ping plan in catalog, not assigned.
    db.seedPlan({
      code: 'ping-orphan',
      sellPrice: '99.000000',
      providerCost: '1',
      checkType: 'PING',
    });

    await expectTariffBlocked(billing, tenantId, 'PING');
    const hlr = await billing.estimate({ tenantId, checkType: 'HLR', unitCount: 1 });
    expect(hlr.unitSellPrice).toBe('1.5');
    expect(hlr.unitSellPrice).not.toBe('99');
  });

  it('ping-only never falls back to an HLR plan price (regression)', async () => {
    const { db, billing, tenantId } = setupState('ping-only');
    db.seedPlan({
      code: 'hlr-orphan',
      sellPrice: '77.000000',
      providerCost: '1',
      checkType: 'HLR',
    });

    await expectTariffBlocked(billing, tenantId, 'HLR');
    const ping = await billing.estimate({ tenantId, checkType: 'PING', unitCount: 1 });
    expect(ping.unitSellPrice).toBe('2.5');
    expect(ping.unitSellPrice).not.toBe('77');
  });

  it('inspect marks inactive assigned plan as invalid (admin detail semantics)', async () => {
    const db = new FakeBillingPrisma();
    const tenantId = 'tenant-invalid';
    db.seedWallet(tenantId, '10');
    const plan = db.seedAssignedPlan(tenantId, {
      code: 'hlr-dead',
      sellPrice: '1',
      checkType: 'HLR',
    });
    const row = db.tariffPlans.get(plan.id)!;
    row.isActive = false;

    const billing = createBilling(db);
    const inspected = await billing.inspectProductTariffs(tenantId);
    expect(inspected.hlr.status).toBe('invalid');
    expect(inspected.hlr.quote).toBeNull();
    expect(inspected.hlr.reasonCode).toMatch(/TARIFF|INVALID/);
    expect(inspected.ping.status).toBe('none');

    // Display quote must also be null (cabinet availability).
    const quotes = await billing.quoteProducts(tenantId);
    expect(quotes.hlr).toBeNull();
    expect(quotes.ping).toBeNull();
  });

  it('reserve after unassign fails even with frozen snapshot (gate)', async () => {
    const { db, billing, tenantId } = setupState('both');
    const hlrItem = db.seedJobItem(tenantId, undefined, { checkType: 'HLR' });
    const pingItem = db.seedJobItem(tenantId, undefined, { checkType: 'PING' });

    db.clearTenantTariffs(tenantId);

    await expect(
      billing.reserveForJobItem({
        tenantId,
        jobItemId: hlrItem.id,
        checkType: 'HLR',
      }),
    ).rejects.toMatchObject({ code: 'TARIFF_NOT_CONFIGURED' });
    await expect(
      billing.reserveForJobItem({
        tenantId,
        jobItemId: pingItem.id,
        checkType: 'PING',
      }),
    ).rejects.toMatchObject({ code: 'TARIFF_NOT_CONFIGURED' });
  });

  it('wrong-type reserve against snapshot is CHECK_TYPE_MISMATCH in every assignment state', async () => {
    for (const state of ['hlr-only', 'ping-only', 'both'] as const) {
      const { db, billing, tenantId } = setupState(state);
      const checkType = state === 'ping-only' ? 'PING' : 'HLR';
      const item = db.seedJobItem(tenantId, undefined, { checkType });
      const wrong = checkType === 'HLR' ? 'PING' : 'HLR';
      await expect(
        billing.reserveForJobItem({
          tenantId,
          jobItemId: item.id,
          checkType: wrong,
        }),
      ).rejects.toMatchObject({ code: 'CHECK_TYPE_MISMATCH' });
    }
  });
});

describe('admin list summary vs billable inspect (documented gap)', () => {
  it('row existence ≠ billable: summary would show code while quote is null', async () => {
    const db = new FakeBillingPrisma();
    const tenantId = 'tenant-stale';
    db.seedWallet(tenantId, '10');
    const plan = db.seedAssignedPlan(tenantId, {
      code: 'hlr-stale',
      sellPrice: '1',
      checkType: 'HLR',
    });
    db.tariffPlans.get(plan.id)!.isActive = false;

    // Admin list helper semantics (row present → show code).
    const assignment = [...db.tenantTariffs.values()].find((r) => r.tenantId === tenantId);
    expect(assignment).toBeTruthy();
    expect(db.tariffPlans.get(assignment!.tariffPlanId)?.code).toBe('hlr-stale');

    // Billable path (cabinet + admin detail inspect) must treat as unavailable.
    const billing = createBilling(db);
    expect(await billing.quoteProduct(tenantId, 'HLR')).toBeNull();
    expect((await billing.inspectProductTariff(tenantId, 'HLR')).status).toBe('invalid');
  });
});

/** Stabilize Decimal string expectations for 1.5*2 / 2.5*2. */
describe('matrix money helpers', () => {
  it('Prisma decimal mul matches estimate totals used above', () => {
    expect(new Prisma.Decimal('1.5').mul(2).toString()).toBe('3');
    expect(new Prisma.Decimal('2.5').mul(2).toString()).toBe('5');
  });
});
