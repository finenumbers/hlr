import { describe, expect, it } from 'vitest';

import { Prisma, type PrismaClient } from '@finenumbers/db';

import { BillingService } from './billing.service.js';
import type { BillingError } from './errors.js';
import { createBillingJobsHooks } from './jobs-billing.hooks.js';
import { FakeBillingPrisma } from './test-fake-prisma.js';

function createBilling(db: FakeBillingPrisma): BillingService {
  return new BillingService({ prisma: db as unknown as PrismaClient });
}

describe('BillingService ledger flows', () => {
  it('reserves successfully and moves available → held', async () => {
    const db = new FakeBillingPrisma();
    const tenantId = 'tenant-1';
    db.seedWallet(tenantId, '10.000000');
    const plan = db.seedAssignedPlan(tenantId, {
      code: 'default',
      sellPrice: '1.500000',
      providerCost: '0.400000',
      checkType: 'HLR',
    });
    const item = db.seedJobItem(tenantId);
    const billing = createBilling(db);

    const result = await billing.reserveForJobItem({
      tenantId,
      jobItemId: item.id,
      checkType: 'HLR',
    });

    expect(result.created).toBe(true);
    expect(result.hold.type).toBe('HOLD');
    expect(result.hold.amount).toBe('1.5');
    expect(result.wallet.availableBalance).toBe('8.5');
    expect(result.wallet.heldBalance).toBe('1.5');
    expect(result.tariff.tariffPlanId).toBe(plan.id);
    expect(result.tariff.providerCost).toBe('0.4');
    expect(db.jobItems.get(item.id)?.estimatedCost?.toString()).toBe('1.5');
  });

  it('rejects reserve on insufficient funds', async () => {
    const db = new FakeBillingPrisma();
    const tenantId = 'tenant-1';
    db.seedWallet(tenantId, '0.500000');
    db.seedAssignedPlan(tenantId, {
      code: 'default',
      sellPrice: '1.500000',
      checkType: 'HLR',
    });
    const item = db.seedJobItem(tenantId);
    const billing = createBilling(db);

    await expect(
      billing.reserveForJobItem({
        tenantId,
        jobItemId: item.id,
        checkType: 'HLR',
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' } satisfies Partial<BillingError>);

    const wallet = await billing.getWallet(tenantId);
    expect(wallet.availableBalance).toBe('0.5');
    expect(wallet.heldBalance).toBe('0');
    expect(db.transactions).toHaveLength(0);
  });

  it('finalizes exact charge (capture = full hold)', async () => {
    const db = new FakeBillingPrisma();
    const tenantId = 'tenant-1';
    db.seedWallet(tenantId, '5.000000');
    db.seedAssignedPlan(tenantId, {
      code: 'default',
      sellPrice: '1.250000',
      checkType: 'HLR',
    });
    const item = db.seedJobItem(tenantId);
    const billing = createBilling(db);

    await billing.reserveForJobItem({
      tenantId,
      jobItemId: item.id,
      checkType: 'HLR',
    });
    const capture = await billing.captureForJobItem({
      tenantId,
      jobItemId: item.id,
    });

    expect(capture.created).toBe(true);
    expect(capture.chargedAmount).toBe('1.25');
    expect(capture.releasedAmount).toBe('0');
    expect(capture.debit?.type).toBe('DEBIT');
    expect(capture.debit?.relatedHoldId).toBeTruthy();
    expect(capture.wallet.availableBalance).toBe('3.75');
    expect(capture.wallet.heldBalance).toBe('0');
    expect(db.jobItems.get(item.id)?.actualCost?.toString()).toBe('1.25');
  });

  it('partial release when charge < hold', async () => {
    const db = new FakeBillingPrisma();
    const tenantId = 'tenant-1';
    db.seedWallet(tenantId, '10.000000');
    db.seedAssignedPlan(tenantId, {
      code: 'default',
      sellPrice: '2.000000',
      checkType: 'HLR',
    });
    const item = db.seedJobItem(tenantId);
    const billing = createBilling(db);

    await billing.reserveForJobItem({
      tenantId,
      jobItemId: item.id,
      checkType: 'HLR',
    });
    const capture = await billing.captureForJobItem({
      tenantId,
      jobItemId: item.id,
      chargeAmount: '0.750000',
    });

    expect(capture.chargedAmount).toBe('0.75');
    expect(capture.releasedAmount).toBe('1.25');
    expect(capture.release?.type).toBe('RELEASE');
    expect(capture.wallet.availableBalance).toBe('9.25');
    expect(capture.wallet.heldBalance).toBe('0');
  });

  it('full release restores available balance', async () => {
    const db = new FakeBillingPrisma();
    const tenantId = 'tenant-1';
    db.seedWallet(tenantId, '4.000000');
    db.seedAssignedPlan(tenantId, {
      code: 'default',
      sellPrice: '1.000000',
      checkType: 'HLR',
    });
    const item = db.seedJobItem(tenantId);
    const billing = createBilling(db);

    await billing.reserveForJobItem({
      tenantId,
      jobItemId: item.id,
      checkType: 'HLR',
    });
    const release = await billing.releaseForJobItem({
      tenantId,
      jobItemId: item.id,
      reason: 'submit_failed',
    });

    expect(release.created).toBe(true);
    expect(release.releasedAmount).toBe('1');
    expect(release.wallet.availableBalance).toBe('4');
    expect(release.wallet.heldBalance).toBe('0');
  });

  it('is idempotent for reserve / capture / release duplicates', async () => {
    const db = new FakeBillingPrisma();
    const tenantId = 'tenant-1';
    db.seedWallet(tenantId, '10.000000');
    db.seedAssignedPlan(tenantId, {
      code: 'default',
      sellPrice: '1.000000',
      checkType: 'HLR',
    });
    const item = db.seedJobItem(tenantId);
    const billing = createBilling(db);

    const r1 = await billing.reserveForJobItem({
      tenantId,
      jobItemId: item.id,
      checkType: 'HLR',
    });
    const r2 = await billing.reserveForJobItem({
      tenantId,
      jobItemId: item.id,
      checkType: 'HLR',
    });
    expect(r2.created).toBe(false);
    expect(r2.hold.id).toBe(r1.hold.id);
    expect(r2.wallet.heldBalance).toBe('1');

    const c1 = await billing.captureForJobItem({ tenantId, jobItemId: item.id });
    const c2 = await billing.captureForJobItem({ tenantId, jobItemId: item.id });
    expect(c2.created).toBe(false);
    expect(c2.debit?.id).toBe(c1.debit?.id);
    expect(db.transactions.filter((t) => t.type === 'DEBIT')).toHaveLength(1);

    // release after capture must not reverse the debit
    const rel = await billing.releaseForJobItem({ tenantId, jobItemId: item.id });
    expect(rel.created).toBe(false);
    expect(rel.releasedAmount).toBe('0');
    expect((await billing.getWallet(tenantId)).availableBalance).toBe('9');
  });

  it('manual top-up credits available balance and is idempotent', async () => {
    const db = new FakeBillingPrisma();
    const tenantId = 'tenant-1';
    db.seedWallet(tenantId, '0');
    const audits: Array<{ action: string }> = [];
    const billing = new BillingService({
      prisma: db as unknown as PrismaClient,
      audit: async (input) => {
        audits.push({ action: input.action });
      },
    });

    const t1 = await billing.topup({
      tenantId,
      amount: '100.500000',
      createdById: 'admin-1',
      idempotencyKey: 'topup-1',
      description: 'Wire transfer',
    });
    const t2 = await billing.topup({
      tenantId,
      amount: '100.500000',
      createdById: 'admin-1',
      idempotencyKey: 'topup-1',
    });

    expect(t1.created).toBe(true);
    expect(t2.created).toBe(false);
    expect(t1.credit.type).toBe('CREDIT');
    expect(t2.wallet.availableBalance).toBe('100.5');
    expect(db.transactions.filter((t) => t.type === 'CREDIT')).toHaveLength(1);
    expect(audits).toEqual([{ action: 'billing.wallet.topup' }]);
  });

  it('applies tenant tariff override for sell price (provider cost stays on plan)', async () => {
    const db = new FakeBillingPrisma();
    const tenantId = 'tenant-1';
    db.seedWallet(tenantId, '20');
    db.seedAssignedPlan(tenantId, {
      code: 'standard',
      sellPrice: '1.000000',
      providerCost: '0.300000',
      checkType: 'HLR',
      priceOverride: '0.800000',
    });
    const item = db.seedJobItem(tenantId);
    const billing = createBilling(db);

    const estimate = await billing.estimate({
      tenantId,
      checkType: 'HLR',
      unitCount: 2,
    });
    expect(estimate.unitSellPrice).toBe('0.8');
    expect(estimate.unitProviderCost).toBe('0.3');
    expect(estimate.estimatedSellTotal).toBe('1.6');
    expect(estimate.tariff.source).toBe('tenant_override');

    const reserved = await billing.reserveForJobItem({
      tenantId,
      jobItemId: item.id,
      checkType: 'HLR',
    });
    expect(reserved.hold.amount).toBe('0.8');
    expect(reserved.tariff.providerCost).toBe('0.3');
  });

  it('rejects when no tariff is configured', async () => {
    const db = new FakeBillingPrisma();
    const tenantId = 'tenant-1';
    db.seedWallet(tenantId, '10');
    const billing = createBilling(db);

    await expect(
      billing.estimate({ tenantId, checkType: 'PING', unitCount: 1 }),
    ).rejects.toMatchObject({ code: 'TARIFF_NOT_CONFIGURED' });
  });

  it('uses distinct HLR vs Ping prices and never falls back across checkType', async () => {
    const db = new FakeBillingPrisma();
    const tenantId = 'tenant-1';
    db.seedWallet(tenantId, '0');
    const hlrPlan = db.seedAssignedPlan(tenantId, {
      code: 'hlr-2',
      sellPrice: '2.000000',
      providerCost: '0.500000',
      checkType: 'HLR',
    });
    const pingPlan = db.seedAssignedPlan(tenantId, {
      code: 'ping-5',
      sellPrice: '5.000000',
      providerCost: '1.000000',
      checkType: 'PING',
    });
    const billing = createBilling(db);
    await billing.topup({
      tenantId,
      amount: '100',
      createdById: 'admin-1',
      idempotencyKey: 'dual-tariff-topup',
    });

    const hlrEst = await billing.estimate({ tenantId, checkType: 'HLR', unitCount: 3 });
    const pingEst = await billing.estimate({ tenantId, checkType: 'PING', unitCount: 3 });
    expect(hlrEst.unitSellPrice).toBe('2');
    expect(hlrEst.estimatedSellTotal).toBe('6');
    expect(hlrEst.tariff.tariffPlanId).toBe(hlrPlan.id);
    expect(pingEst.unitSellPrice).toBe('5');
    expect(pingEst.estimatedSellTotal).toBe('15');
    expect(pingEst.tariff.tariffPlanId).toBe(pingPlan.id);

    const hlrItem = db.seedJobItem(tenantId, undefined, { checkType: 'HLR' });
    const pingItem = db.seedJobItem(tenantId, undefined, { checkType: 'PING' });

    const hlrHold = await billing.reserveForJobItem({
      tenantId,
      jobItemId: hlrItem.id,
      checkType: 'HLR',
    });
    const pingHold = await billing.reserveForJobItem({
      tenantId,
      jobItemId: pingItem.id,
      checkType: 'PING',
    });
    expect(hlrHold.hold.amount).toBe('2');
    expect(pingHold.hold.amount).toBe('5');

    // Unassign HLR only — Ping must keep working; HLR must not use Ping price.
    for (const [id, row] of db.tenantTariffs) {
      if (row.tenantId === tenantId && row.checkType === 'HLR') {
        db.tenantTariffs.delete(id);
      }
    }

    await expect(
      billing.estimate({ tenantId, checkType: 'HLR', unitCount: 1 }),
    ).rejects.toMatchObject({ code: 'TARIFF_NOT_CONFIGURED' });

    const stillPing = await billing.estimate({ tenantId, checkType: 'PING', unitCount: 1 });
    expect(stillPing.unitSellPrice).toBe('5');

    const orphanHlr = db.seedJobItem(tenantId, undefined, {
      checkType: 'HLR',
      unitSellPrice: '2.000000',
      unitProviderCost: '0.500000',
      tariffPlanId: hlrPlan.id,
      tariffPlanCode: hlrPlan.code,
    });
    await expect(
      billing.reserveForJobItem({
        tenantId,
        jobItemId: orphanHlr.id,
        checkType: 'HLR',
      }),
    ).rejects.toMatchObject({ code: 'TARIFF_NOT_CONFIGURED' });

    // Capture without HOLD cannot invent a charge from the other product's tariff.
    const noHoldCharge = await billing.captureForJobItem({
      tenantId,
      jobItemId: orphanHlr.id,
    });
    expect(noHoldCharge.chargedAmount).toBe('0');
    expect(noHoldCharge.debit).toBeNull();

    // Dual assignment + ledger reconcile still matches (wallet ops are tariff-agnostic).
    const wallet = await billing.getWallet(tenantId);
    const recon = await billing.reconcileWallet(tenantId);
    expect(recon.matched).toBe(true);
    expect(recon.cache.availableBalance).toBe(wallet.availableBalance);
  });

  it('rejects reserve without price snapshot and on checkType mismatch', async () => {
    const db = new FakeBillingPrisma();
    const tenantId = 'tenant-1';
    db.seedWallet(tenantId, '20');
    db.seedAssignedPlan(tenantId, {
      code: 'hlr-a',
      sellPrice: '1.000000',
      checkType: 'HLR',
    });
    db.seedAssignedPlan(tenantId, {
      code: 'ping-a',
      sellPrice: '3.000000',
      checkType: 'PING',
    });
    const billing = createBilling(db);

    const noSnap = db.seedJobItem(tenantId);
    noSnap.unitSellPrice = null;
    noSnap.unitProviderCost = null;
    await expect(
      billing.reserveForJobItem({
        tenantId,
        jobItemId: noSnap.id,
        checkType: 'HLR',
      }),
    ).rejects.toMatchObject({ code: 'PRICE_SNAPSHOT_MISSING' });

    const hlrItem = db.seedJobItem(tenantId, undefined, { checkType: 'HLR' });
    await expect(
      billing.reserveForJobItem({
        tenantId,
        jobItemId: hlrItem.id,
        checkType: 'PING',
      }),
    ).rejects.toMatchObject({ code: 'CHECK_TYPE_MISMATCH' });
  });

  it('assertCanAffordFrozen uses snapshot price and still gates assignment', async () => {
    const db = new FakeBillingPrisma();
    const tenantId = 'tenant-1';
    db.seedWallet(tenantId, '0');
    db.seedAssignedPlan(tenantId, {
      code: 'hlr-live',
      sellPrice: '9.000000', // live catalog — must NOT be used for total
      checkType: 'HLR',
    });
    const billing = createBilling(db);
    await billing.topup({
      tenantId,
      amount: '10',
      createdById: 'admin-1',
      idempotencyKey: 'f1',
    });

    // 2 × frozen 1.5 = 3 ≤ 10 → ok even though live is 9
    await expect(
      billing.assertCanAffordFrozen({
        tenantId,
        checkType: 'HLR',
        unitCount: 2,
        unitSellPrice: '1.500000',
      }),
    ).resolves.toMatchObject({ required: '3' });

    // 2 × 6 = 12 > 10 → insufficient at frozen price
    await expect(
      billing.assertCanAffordFrozen({
        tenantId,
        checkType: 'HLR',
        unitCount: 2,
        unitSellPrice: '6.000000',
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });

    db.clearTenantTariffs(tenantId);
    await expect(
      billing.assertCanAffordFrozen({
        tenantId,
        checkType: 'HLR',
        unitCount: 1,
        unitSellPrice: '1.500000',
      }),
    ).rejects.toMatchObject({ code: 'TARIFF_NOT_CONFIGURED' });
  });

  it('reserves at job-accept snapshot even if live sell price changed', async () => {
    const db = new FakeBillingPrisma();
    const tenantId = 'tenant-1';
    db.seedWallet(tenantId, '20');
    const plan = db.seedAssignedPlan(tenantId, {
      code: 'hlr-a',
      sellPrice: '1.000000',
      providerCost: '0.200000',
      checkType: 'HLR',
    });
    const item = db.seedJobItem(tenantId, undefined, {
      unitSellPrice: '1.000000',
      unitProviderCost: '0.200000',
      tariffPlanId: plan.id,
      tariffPlanCode: plan.code,
    });
    // Admin raises catalog price after job was accepted.
    plan.sellPrice = new Prisma.Decimal('9.000000');
    const billing = createBilling(db);

    const reserved = await billing.reserveForJobItem({
      tenantId,
      jobItemId: item.id,
      checkType: 'HLR',
    });

    expect(reserved.hold.amount).toBe('1');
    expect(reserved.tariff.sellPrice).toBe('1');
    expect(db.jobItems.get(item.id)?.estimatedCost?.toString()).toBe('1');
  });

  it('rejects reserve when product tariff was unassigned after job create', async () => {
    const db = new FakeBillingPrisma();
    const tenantId = 'tenant-1';
    db.seedWallet(tenantId, '20');
    const plan = db.seedAssignedPlan(tenantId, {
      code: 'hlr-a',
      sellPrice: '1.000000',
      checkType: 'HLR',
    });
    const item = db.seedJobItem(tenantId, undefined, {
      unitSellPrice: '1.000000',
      tariffPlanId: plan.id,
      tariffPlanCode: plan.code,
    });
    db.clearTenantTariffs(tenantId);
    const billing = createBilling(db);

    await expect(
      billing.reserveForJobItem({
        tenantId,
        jobItemId: item.id,
        checkType: 'HLR',
      }),
    ).rejects.toMatchObject({ code: 'TARIFF_NOT_CONFIGURED' });
    expect(db.transactions).toHaveLength(0);
  });

  it('jobs hooks: reserve → capture / release', async () => {
    const db = new FakeBillingPrisma();
    const tenantId = 'tenant-1';
    db.seedWallet(tenantId, '10');
    db.seedAssignedPlan(tenantId, {
      code: 'default',
      sellPrice: '1.000000',
      checkType: 'HLR',
    });
    const okItem = db.seedJobItem(tenantId);
    const failItem = db.seedJobItem(tenantId);
    const billing = createBilling(db);
    const hooks = createBillingJobsHooks(billing);

    await hooks.onItemReserved({
      tenantId,
      jobItemId: okItem.id,
      checkType: 'HLR',
    });
    await hooks.onItemTerminal({
      tenantId,
      jobItemId: okItem.id,
      status: 'COMPLETED',
      billingAction: 'capture',
    });

    await hooks.onItemReserved({
      tenantId,
      jobItemId: failItem.id,
      checkType: 'HLR',
    });
    await hooks.onItemTerminal({
      tenantId,
      jobItemId: failItem.id,
      status: 'FAILED',
      billingAction: 'release',
    });

    const wallet = await billing.getWallet(tenantId);
    // one captured (1) + one released back → net -1
    expect(wallet.availableBalance).toBe('9');
    expect(wallet.heldBalance).toBe('0');

    await hooks.onJobFinalized({
      tenantId,
      jobId: okItem.jobId,
      status: 'COMPLETED_WITH_ERRORS',
    });
    expect(db.jobs.get(okItem.jobId)?.actualCost?.toString()).toBe('1');
  });

  it('forbids negative adjustment against available by default', async () => {
    const db = new FakeBillingPrisma();
    const tenantId = 'tenant-1';
    db.seedWallet(tenantId, '1');
    const billing = createBilling(db);

    await expect(
      billing.adjust({
        tenantId,
        amount: '5',
        direction: 'debit',
        createdById: 'admin-1',
        idempotencyKey: 'adj-1',
      }),
    ).rejects.toMatchObject({ code: 'NEGATIVE_BALANCE_FORBIDDEN' });
  });

  it('reconstructs balances from wallet_transactions independently of cache', async () => {
    const db = new FakeBillingPrisma();
    const tenantId = 'tenant-1';
    const wallet = db.seedWallet(tenantId, '0');
    db.seedAssignedPlan(tenantId, {
      code: 'default',
      sellPrice: '3.000000',
      checkType: 'HLR',
    });
    const item = db.seedJobItem(tenantId);
    const billing = createBilling(db);

    await billing.topup({
      tenantId,
      amount: '20',
      createdById: 'admin-1',
      idempotencyKey: 't1',
    });
    await billing.reserveForJobItem({
      tenantId,
      jobItemId: item.id,
      checkType: 'HLR',
    });
    await billing.captureForJobItem({
      tenantId,
      jobItemId: item.id,
      chargeAmount: '1',
    });

    const cache = await billing.getWallet(tenantId);
    const fromLedger = await billing.getBalancesFromLedger(tenantId);
    expect(fromLedger.availableBalance).toBe(cache.availableBalance);
    expect(fromLedger.heldBalance).toBe(cache.heldBalance);
    expect(fromLedger.availableBalance).toBe('19');
    expect(fromLedger.heldBalance).toBe('0');
    expect(fromLedger.entryCount).toBeGreaterThan(0);

    // Corrupt cache — ledger fold must still be correct and able to repair.
    wallet.availableBalance = new Prisma.Decimal('999');
    wallet.heldBalance = new Prisma.Decimal('7');

    const drifted = await billing.reconcileWallet(tenantId);
    expect(drifted.matched).toBe(false);
    expect(drifted.ledger.availableBalance).toBe('19');
    expect(drifted.ledger.heldBalance).toBe('0');

    const repaired = await billing.reconcileWallet(tenantId, { repair: true });
    expect(repaired.repaired).toBe(true);
    expect(repaired.ledger.availableBalance).toBe('19');
    expect((await billing.getWallet(tenantId)).availableBalance).toBe('19');
    expect((await billing.getWallet(tenantId)).heldBalance).toBe('0');
  });
});
