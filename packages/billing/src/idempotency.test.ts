import { describe, expect, it } from 'vitest';

import type { PrismaClient } from '@finenumbers/db';

import { BillingService } from './billing.service.js';
import { createBillingJobsHooks } from './jobs-billing.hooks.js';
import { FakeBillingPrisma } from './test-fake-prisma.js';

function createBilling(db: FakeBillingPrisma): BillingService {
  return new BillingService({ prisma: db as unknown as PrismaClient });
}

function countByType(db: FakeBillingPrisma, type: string): number {
  return db.transactions.filter((t) => t.type === type).length;
}

describe('billing idempotency — no double charge', () => {
  it('retries of reserve/capture never create a second HOLD or DEBIT', async () => {
    const db = new FakeBillingPrisma();
    const tenantId = 'tenant-1';
    // Start at 0 + CREDIT via ledger (never invent cache balance without a ledger row).
    db.seedWallet(tenantId, '0');
    db.seedPlan({
      code: 'default',
      hlrPrice: '4.500000',
      pingPrice: '2.000000',
      isDefault: true,
    });
    const item = db.seedJobItem(tenantId);
    const billing = createBilling(db);
    await billing.topup({
      tenantId,
      amount: '100',
      createdById: 'admin-1',
      idempotencyKey: 'seed-funds',
    });

    for (let i = 0; i < 5; i += 1) {
      await billing.reserveForJobItem({
        tenantId,
        jobItemId: item.id,
        checkType: 'HLR',
      });
    }
    expect(countByType(db, 'HOLD')).toBe(1);
    expect((await billing.getWallet(tenantId)).heldBalance).toBe('4.5');
    expect((await billing.getWallet(tenantId)).availableBalance).toBe('95.5');

    for (let i = 0; i < 5; i += 1) {
      await billing.captureForJobItem({ tenantId, jobItemId: item.id });
    }
    expect(countByType(db, 'DEBIT')).toBe(1);
    expect(countByType(db, 'HOLD')).toBe(1);
    expect(countByType(db, 'RELEASE')).toBe(0);

    const fromLedger = await billing.getBalancesFromLedger(tenantId);
    expect(fromLedger.availableBalance).toBe('95.5');
    expect(fromLedger.heldBalance).toBe('0');
  });

  it('retries of release never create a second RELEASE', async () => {
    const db = new FakeBillingPrisma();
    const tenantId = 'tenant-1';
    db.seedWallet(tenantId, '10');
    db.seedPlan({
      code: 'default',
      hlrPrice: '2.000000',
      pingPrice: '2.000000',
      isDefault: true,
    });
    const item = db.seedJobItem(tenantId);
    const billing = createBilling(db);

    await billing.reserveForJobItem({
      tenantId,
      jobItemId: item.id,
      checkType: 'HLR',
    });

    for (let i = 0; i < 5; i += 1) {
      await billing.releaseForJobItem({
        tenantId,
        jobItemId: item.id,
        reason: 'submit_failed',
      });
    }

    expect(countByType(db, 'HOLD')).toBe(1);
    expect(countByType(db, 'RELEASE')).toBe(1);
    expect(countByType(db, 'DEBIT')).toBe(0);
    expect((await billing.getWallet(tenantId)).availableBalance).toBe('10');
    expect((await billing.getWallet(tenantId)).heldBalance).toBe('0');
  });

  it('release after capture is a no-op (does not undo debit)', async () => {
    const db = new FakeBillingPrisma();
    const tenantId = 'tenant-1';
    db.seedWallet(tenantId, '10');
    db.seedPlan({
      code: 'default',
      hlrPrice: '3.000000',
      pingPrice: '2.000000',
      isDefault: true,
    });
    const item = db.seedJobItem(tenantId);
    const billing = createBilling(db);

    await billing.reserveForJobItem({
      tenantId,
      jobItemId: item.id,
      checkType: 'HLR',
    });
    await billing.captureForJobItem({ tenantId, jobItemId: item.id });

    for (let i = 0; i < 3; i += 1) {
      const rel = await billing.releaseForJobItem({ tenantId, jobItemId: item.id });
      expect(rel.created).toBe(false);
      expect(rel.releasedAmount).toBe('0');
    }

    expect(countByType(db, 'DEBIT')).toBe(1);
    expect(countByType(db, 'RELEASE')).toBe(0);
    expect((await billing.getWallet(tenantId)).availableBalance).toBe('7');
  });

  it('partial capture remainder release is also idempotent', async () => {
    const db = new FakeBillingPrisma();
    const tenantId = 'tenant-1';
    db.seedWallet(tenantId, '10');
    db.seedPlan({
      code: 'default',
      hlrPrice: '4.000000',
      pingPrice: '2.000000',
      isDefault: true,
    });
    const item = db.seedJobItem(tenantId);
    const billing = createBilling(db);

    await billing.reserveForJobItem({
      tenantId,
      jobItemId: item.id,
      checkType: 'HLR',
    });

    for (let i = 0; i < 4; i += 1) {
      const result = await billing.captureForJobItem({
        tenantId,
        jobItemId: item.id,
        chargeAmount: '1.5',
      });
      expect(result.chargedAmount).toBe('1.5');
      expect(result.releasedAmount).toBe('2.5');
    }

    expect(countByType(db, 'DEBIT')).toBe(1);
    expect(countByType(db, 'RELEASE')).toBe(1);
    expect((await billing.getWallet(tenantId)).availableBalance).toBe('8.5');
    expect((await billing.getWallet(tenantId)).heldBalance).toBe('0');
  });

  it('top-up and adjustment retries do not double-apply', async () => {
    const db = new FakeBillingPrisma();
    const tenantId = 'tenant-1';
    db.seedWallet(tenantId, '0');
    const billing = createBilling(db);

    for (let i = 0; i < 5; i += 1) {
      await billing.topup({
        tenantId,
        amount: '25.5',
        createdById: 'admin-1',
        idempotencyKey: 'wire-001',
      });
    }
    expect(countByType(db, 'CREDIT')).toBe(1);
    expect((await billing.getWallet(tenantId)).availableBalance).toBe('25.5');

    for (let i = 0; i < 5; i += 1) {
      await billing.adjust({
        tenantId,
        amount: '5.5',
        direction: 'debit',
        createdById: 'admin-1',
        idempotencyKey: 'adj-001',
      });
    }
    expect(countByType(db, 'ADJUSTMENT')).toBe(1);
    expect((await billing.getWallet(tenantId)).availableBalance).toBe('20');
  });

  it('links HOLD/DEBIT/RELEASE to jobItem and embeds jobId in metadata', async () => {
    const db = new FakeBillingPrisma();
    const tenantId = 'tenant-1';
    db.seedWallet(tenantId, '0');
    db.seedPlan({
      code: 'default',
      hlrPrice: '1.000000',
      pingPrice: '2.000000',
      isDefault: true,
    });
    const item = db.seedJobItem(tenantId);
    const billing = createBilling(db);
    await billing.topup({
      tenantId,
      amount: '10',
      createdById: 'admin-1',
      idempotencyKey: 'seed',
    });
    await billing.reserveForJobItem({
      tenantId,
      jobItemId: item.id,
      checkType: 'HLR',
    });
    await billing.captureForJobItem({ tenantId, jobItemId: item.id });

    const byItem = await billing.listLedgerForJobItem(item.id);
    expect(byItem.map((e) => e.type).sort()).toEqual(['DEBIT', 'HOLD']);
    for (const entry of byItem) {
      expect(entry.jobItemId).toBe(item.id);
      const meta = entry.metadata as { jobId?: string; phoneE164?: string };
      expect(meta.jobId).toBe(item.jobId);
      expect(meta.phoneE164).toBe('+79001234567');
    }

    const byJob = await billing.listLedgerForJob(item.jobId);
    expect(byJob).toHaveLength(2);
    expect(byJob.every((e) => e.jobItemId === item.id)).toBe(true);
  });

  it('jobs hooks retries do not double-charge', async () => {
    const db = new FakeBillingPrisma();
    const tenantId = 'tenant-1';
    db.seedWallet(tenantId, '0');
    db.seedPlan({
      code: 'default',
      hlrPrice: '1.000000',
      pingPrice: '2.000000',
      isDefault: true,
    });
    const item = db.seedJobItem(tenantId);
    const billing = createBilling(db);
    await billing.topup({
      tenantId,
      amount: '50',
      createdById: 'admin-1',
      idempotencyKey: 'seed-funds',
    });
    const hooks = createBillingJobsHooks(billing);

    for (let i = 0; i < 3; i += 1) {
      await hooks.onItemReserved({
        tenantId,
        jobItemId: item.id,
        checkType: 'HLR',
      });
    }
    for (let i = 0; i < 3; i += 1) {
      await hooks.onItemTerminal({
        tenantId,
        jobItemId: item.id,
        status: 'COMPLETED',
        billingAction: 'capture',
      });
    }

    expect(countByType(db, 'HOLD')).toBe(1);
    expect(countByType(db, 'DEBIT')).toBe(1);
    expect((await billing.getBalancesFromLedger(tenantId)).availableBalance).toBe('49');
  });
});
