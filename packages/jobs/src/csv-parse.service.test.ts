import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CsvParseService, streamParsePhoneFile } from './csv-parse.service.js';
import { InMemoryJobsQueue } from './memory-queue.js';
import { InMemoryJobsStore } from './memory-store.js';

describe('streamParsePhoneFile', () => {
  it('parses phones and skips header', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fn-csv-'));
    const path = join(dir, 'phones.csv');
    await writeFile(path, 'phone\n+79991234567\n79997654321\n', 'utf8');

    const result = await streamParsePhoneFile(path, { maxRows: 100 });
    expect(result.truncated).toBe(false);
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
  it('attaches items and enqueues submit batches', async () => {
    const store = new InMemoryJobsStore();
    const queue = new InMemoryJobsQueue();
    const service = new CsvParseService({ store, queue });

    const shell = await store.createJobShell({
      tenantId: 't1',
      checkType: 'HLR',
      source: 'BULK',
      idempotencyKey: null,
      createdByUserId: null,
      apiKeyId: null,
      originalFilename: 'a.csv',
      currency: 'RUB',
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
    expect(result.batchesEnqueued).toBeGreaterThan(0);
    expect(queue.of('submit').length).toBeGreaterThan(0);
  });
});
