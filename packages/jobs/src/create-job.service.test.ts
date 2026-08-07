import { describe, expect, it } from 'vitest';

import { CreateJobService } from './create-job.service.js';
import { InMemoryJobsQueue } from './memory-queue.js';
import { InMemoryJobsStore } from './memory-store.js';
import { JobsValidationError, type JobPriceSnapshot } from './types.js';

const snap = (checkType: 'HLR' | 'PING' = 'HLR'): JobPriceSnapshot => ({
  unitSellPrice: checkType === 'HLR' ? '1.5' : '2.5',
  unitProviderCost: '0.4',
  tariffPlanId: `plan-${checkType.toLowerCase()}`,
  tariffPlanCode: `code-${checkType.toLowerCase()}`,
  currency: 'RUB',
});

describe('CreateJobService', () => {
  it('creates job, dedupes phones, and enqueues submit batches', async () => {
    const store = new InMemoryJobsStore();
    store.settings = { ...store.settings, submitBatchSize: 2, maxBatchPhones: 100 };
    const queue = new InMemoryJobsQueue();
    const service = new CreateJobService({ store, queue });

    const result = await service.create({
      tenantId: 'tenant-1',
      checkType: 'HLR',
      source: 'BULK',
      phones: ['+79991234567', '79991234567', '+79997654321', '+79991112233'],
      priceSnapshot: snap('HLR'),
    });

    expect(result.deduplicated).toBe(false);
    expect(result.deduplicatedPhoneCount).toBe(1);
    expect(result.workUnits).toBe(3);
    expect(result.job.itemCount).toBe(3);
    expect(result.job.status).toBe('QUEUED');
    expect(result.batchesEnqueued).toBe(2);
    expect(queue.of('submit')).toHaveLength(2);
    expect(queue.of('submit')[0]).toMatchObject({
      payload: { jobId: result.job.id, tenantId: 'tenant-1' },
    });
  });

  it('returns existing job for idempotency key without creating a second job', async () => {
    const store = new InMemoryJobsStore();
    const queue = new InMemoryJobsQueue();
    const service = new CreateJobService({ store, queue });

    const first = await service.create({
      tenantId: 'tenant-1',
      checkType: 'PING',
      source: 'API',
      phones: ['+79991234567'],
      idempotencyKey: 'idem-1',
      priceSnapshot: snap('PING'),
    });
    queue.clear();

    const second = await service.create({
      tenantId: 'tenant-1',
      checkType: 'PING',
      source: 'API',
      phones: ['+79991234567'],
      idempotencyKey: 'idem-1',
      priceSnapshot: snap('PING'),
    });

    expect(second.deduplicated).toBe(true);
    expect(second.job.id).toBe(first.job.id);
    expect(queue.messages).toHaveLength(0);
    const byKey = await store.findJobByIdempotencyKey('tenant-1', 'idem-1');
    expect(byKey?.id).toBe(first.job.id);
  });

  it('concurrent creates with same idempotency key collapse to one job', async () => {
    const store = new InMemoryJobsStore();
    const queue = new InMemoryJobsQueue();
    const service = new CreateJobService({ store, queue });

    // Force both callers past the pre-check by delaying the first write slightly.
    const originalCreate = store.createJobWithItems.bind(store);
    let gate: (() => void) | null = null;
    const released = new Promise<void>((resolve) => {
      gate = resolve;
    });
    let started = 0;
    store.createJobWithItems = async (input) => {
      started += 1;
      if (started === 1) {
        // Let the sibling request also pass findJobByIdempotencyKey.
        await new Promise<void>((r) => setTimeout(r, 20));
        gate?.();
        return originalCreate(input);
      }
      await released;
      return originalCreate(input);
    };

    const [a, b] = await Promise.all([
      service.create({
        tenantId: 'tenant-1',
        checkType: 'HLR',
        source: 'API',
        phones: ['+79991234567'],
        idempotencyKey: 'race-1',
        priceSnapshot: snap('HLR'),
      }),
      service.create({
        tenantId: 'tenant-1',
        checkType: 'HLR',
        source: 'API',
        phones: ['+79991234567'],
        idempotencyKey: 'race-1',
        priceSnapshot: snap('HLR'),
      }),
    ]);

    expect(a.job.id).toBe(b.job.id);
    expect([a.deduplicated, b.deduplicated].filter(Boolean)).toHaveLength(1);
    const only = await store.findJobByIdempotencyKey('tenant-1', 'race-1');
    expect(only?.id).toBe(a.job.id);
  });

  it('rejects invalid phones and single-source multi-phone', async () => {
    const store = new InMemoryJobsStore();
    const queue = new InMemoryJobsQueue();
    const service = new CreateJobService({ store, queue });

    await expect(
      service.create({
        tenantId: 'tenant-1',
        checkType: 'HLR',
        source: 'SINGLE',
        phones: ['not-valid'],
      }),
    ).rejects.toBeInstanceOf(JobsValidationError);

    await expect(
      service.create({
        tenantId: 'tenant-1',
        checkType: 'HLR',
        source: 'SINGLE',
        phones: ['+79991234567', '+79997654321'],
      }),
    ).rejects.toBeInstanceOf(JobsValidationError);
  });

  it('rejects HLR and PING when any number is not RU mobile 79…', async () => {
    const store = new InMemoryJobsStore();
    const queue = new InMemoryJobsQueue();
    const service = new CreateJobService({ store, queue });

    for (const checkType of ['HLR', 'PING'] as const) {
      await expect(
        service.create({
          tenantId: 'tenant-1',
          checkType,
          source: 'BULK',
          phones: ['+74951234567'],
          priceSnapshot: snap(checkType),
        }),
      ).rejects.toThrow(/мобильных сетях|HLR Lookup/);

      await expect(
        service.create({
          tenantId: 'tenant-1',
          checkType,
          source: 'BULK',
          phones: ['+79001234567', '+74951234567'],
          priceSnapshot: snap(checkType),
        }),
      ).rejects.toBeInstanceOf(JobsValidationError);
    }

    const ok = await service.create({
      tenantId: 'tenant-1',
      checkType: 'HLR',
      source: 'BULK',
      phones: ['+79001234567'],
      priceSnapshot: snap('HLR'),
    });
    expect(ok.workUnits).toBe(1);
  });

  it('deletes the job when enqueueSubmitBatch fails (no junk history)', async () => {
    const store = new InMemoryJobsStore();
    const queue = new InMemoryJobsQueue();
    queue.enqueueSubmitBatch = async () => {
      throw new Error('redis down');
    };
    const service = new CreateJobService({ store, queue });

    await expect(
      service.create({
        tenantId: 'tenant-1',
        checkType: 'HLR',
        source: 'BULK',
        phones: ['+79991234567', '+79997654321'],
        priceSnapshot: snap('HLR'),
      }),
    ).rejects.toThrow('redis down');

    expect(store.jobs.size).toBe(0);
    expect(store.items.size).toBe(0);
  });
});
