import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { CsvParseService, streamParsePhoneFile } from './csv-parse.service.js';
import { InMemoryJobsQueue } from './memory-queue.js';
import { InMemoryJobsStore } from './memory-store.js';

const hlrSnap = {
  unitSellPrice: '1.5',
  unitProviderCost: '0.4',
  tariffPlanId: 'plan-hlr',
  tariffPlanCode: 'hlr',
  currency: 'RUB',
};

describe('streamParsePhoneFile', () => {
  it('parses phones and skips header', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fn-csv-'));
    const path = join(dir, 'phones.csv');
    await writeFile(path, 'phone\n+79991234567\n79997654321\n', 'utf8');

    const result = await streamParsePhoneFile(path, { maxRows: 100 });
    expect(result.truncated).toBe(false);
    expect(result.phones).toEqual(['+79991234567', '79997654321']);
  });

  it('strips UTF-8 BOM from the first phone cell', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fn-csv-'));
    const path = join(dir, 'bom.csv');
    await writeFile(path, '\uFEFF+79991234567\n79997654321\n', 'utf8');

    const result = await streamParsePhoneFile(path, { maxRows: 100 });
    expect(result.phones).toEqual(['+79991234567', '79997654321']);
  });

  it('flags truncation past maxRows', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fn-csv-'));
    const path = join(dir, 'phones.csv');
    await writeFile(path, '+79990000001\n+79990000002\n+79990000003\n', 'utf8');

    const result = await streamParsePhoneFile(path, { maxRows: 2 });
    expect(result.truncated).toBe(true);
    expect(result.phones).toHaveLength(2);
  });
});

describe('CsvParseService', () => {
  it('attaches items and enqueues submit batches using frozen affordability', async () => {
    const store = new InMemoryJobsStore();
    const queue = new InMemoryJobsQueue();
    const assertCanAffordFrozen = vi.fn(async () => undefined);
    const service = new CsvParseService({ store, queue, assertCanAffordFrozen });

    const shell = await store.createJobShell({
      tenantId: 't1',
      checkType: 'HLR',
      source: 'BULK',
      idempotencyKey: null,
      createdByUserId: null,
      apiKeyId: null,
      originalFilename: 'a.csv',
      currency: 'RUB',
      priceSnapshot: hlrSnap,
      metadata: { csvPending: true },
    });

    const dir = await mkdtemp(join(tmpdir(), 'fn-csv-'));
    const path = join(dir, 'phones.csv');
    await writeFile(path, '+79991234567\n+79997654321\n', 'utf8');

    const result = await service.process({
      jobId: shell.id,
      tenantId: 't1',
      filePath: path,
    });

    expect(result.failed).toBe(false);
    expect(result.workUnits).toBe(2);
    expect(assertCanAffordFrozen).toHaveBeenCalledWith({
      tenantId: 't1',
      checkType: 'HLR',
      unitCount: 2,
      unitSellPrice: '1.5',
    });
    expect(queue.of('submit').length).toBeGreaterThan(0);
    const items = await store.listItemsByJobId(shell.id);
    expect(items[0]?.unitSellPrice).toBe('1.5');
    expect(items[0]?.unitProviderCost).toBe('0.4');
  });

  it('fails job when frozen affordability rejects after parse', async () => {
    const store = new InMemoryJobsStore();
    const queue = new InMemoryJobsQueue();
    const service = new CsvParseService({
      store,
      queue,
      assertCanAffordFrozen: async () => {
        throw Object.assign(new Error('Insufficient funds for estimated job cost'), {
          name: 'BillingError',
          code: 'INSUFFICIENT_FUNDS',
        });
      },
    });

    const shell = await store.createJobShell({
      tenantId: 't1',
      checkType: 'PING',
      source: 'BULK',
      idempotencyKey: null,
      createdByUserId: null,
      apiKeyId: null,
      originalFilename: 'b.csv',
      currency: 'RUB',
      priceSnapshot: {
        unitSellPrice: '5',
        unitProviderCost: '1',
        tariffPlanId: 'plan-ping',
        tariffPlanCode: 'ping',
        currency: 'RUB',
      },
      metadata: null,
    });

    const dir = await mkdtemp(join(tmpdir(), 'fn-csv-'));
    const path = join(dir, 'phones.csv');
    await writeFile(path, '+79991234567\n+79997654321\n', 'utf8');

    const result = await service.process({
      jobId: shell.id,
      tenantId: 't1',
      filePath: path,
    });

    expect(result.failed).toBe(true);
    expect(result.job.errorCode).toBe('INSUFFICIENT_FUNDS');
    expect(queue.of('submit')).toHaveLength(0);
    expect(await store.listItemsByJobId(shell.id)).toHaveLength(0);
  });

  it('resumes submit fan-out when items already attached', async () => {
    const store = new InMemoryJobsStore();
    const queue = new InMemoryJobsQueue();
    const service = new CsvParseService({
      store,
      queue,
      assertCanAffordFrozen: async () => undefined,
    });

    const { job } = await store.createJobWithItems({
      tenantId: 't1',
      checkType: 'HLR',
      source: 'BULK',
      phones: ['+79991234567', '+79997654321'],
      idempotencyKey: null,
      createdByUserId: null,
      apiKeyId: null,
      originalFilename: 'resume.csv',
      currency: 'RUB',
      priceSnapshot: hlrSnap,
      metadata: null,
    });

    const dir = await mkdtemp(join(tmpdir(), 'fn-csv-'));
    const path = join(dir, 'gone.csv');
    await writeFile(path, 'should-not-reparse\n', 'utf8');

    const result = await service.process({
      jobId: job.id,
      tenantId: 't1',
      filePath: path,
    });

    expect(result.failed).toBe(false);
    expect(result.batchesEnqueued).toBeGreaterThan(0);
    expect(queue.of('submit').length).toBeGreaterThan(0);
    await expect(import('node:fs/promises').then((fs) => fs.access(path))).rejects.toThrow();
  });

  it('fails when shell has no price snapshot', async () => {
    const store = new InMemoryJobsStore();
    const queue = new InMemoryJobsQueue();
    // Bypass store guard to simulate legacy shell.
    const shell = await store.createJobWithItems({
      tenantId: 't1',
      checkType: 'HLR',
      source: 'BULK',
      phones: [],
      idempotencyKey: null,
      createdByUserId: null,
      apiKeyId: null,
      originalFilename: 'legacy.csv',
      currency: 'RUB',
      metadata: null,
    });
    const service = new CsvParseService({
      store,
      queue,
      assertCanAffordFrozen: async () => undefined,
    });

    const dir = await mkdtemp(join(tmpdir(), 'fn-csv-'));
    const path = join(dir, 'phones.csv');
    await writeFile(path, '+79991234567\n', 'utf8');

    const result = await service.process({
      jobId: shell.job.id,
      tenantId: 't1',
      filePath: path,
    });

    expect(result.failed).toBe(true);
    expect(result.job.errorCode).toBe('PRICE_SNAPSHOT_MISSING');
  });
});
