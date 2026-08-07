import { describe, expect, it, vi } from 'vitest';

import { JobsService } from './jobs.service';

describe('JobsService.createFromPreviewPhones', () => {
  it('creates job with items and enqueues submit batches (no csv-parse / disk)', async () => {
    const job = {
      id: 'job-1',
      tenantId: 'tenant-1',
      checkType: 'HLR' as const,
      source: 'BULK' as const,
      status: 'QUEUED' as const,
      itemCount: 2,
      successCount: 0,
      failureCount: 0,
      estimatedCost: '5.000000',
      actualCost: null,
      currency: 'RUB',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      metadata: { fromPreviewId: 'preview-1' },
    };
    const items = [
      { id: 'item-1', jobId: job.id, tenantId: job.tenantId },
      { id: 'item-2', jobId: job.id, tenantId: job.tenantId },
    ];

    const createJobWithItems = vi.fn(async () => ({ job, items }));
    const createJobShell = vi.fn();
    const enqueueCsvParse = vi.fn();
    const enqueueSubmitBatch = vi.fn(async () => undefined);
    const getRuntimeSettings = vi.fn(async () => ({ submitBatchSize: 50 }));

    const service = Object.create(JobsService.prototype) as JobsService;
    Object.assign(service, {
      prisma: {},
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      billing: {
        assertCanAfford: vi.fn(async () => ({
          currency: 'RUB',
          unitSellPrice: '2.500000',
          unitProviderCost: '0.500000',
          tariff: {
            tariffPlanId: 'plan-1',
            tariffPlanCode: 'hlr-std',
          },
        })),
      },
      store: {
        createJobWithItems,
        createJobShell,
        getRuntimeSettings,
      },
      processor: {
        enqueueSubmitBatch,
        enqueueCsvParse,
      },
    });

    // resolveLimits is imported — mock via prisma platform/tenant reads
    Object.assign(service, {
      prisma: {
        tenant: {
          findUnique: vi.fn(async () => ({
            rateLimitRpm: null,
            maxCsvRows: 100_000,
            maxCsvBytes: null,
            maxBatchPhones: null,
          })),
        },
        platformSettings: {
          findUnique: vi.fn(async () => ({
            defaultRateLimitRpm: 60,
            maxCsvRows: 100_000,
            maxCsvBytes: 52_428_800,
            maxBatchPhones: 1_000,
          })),
        },
      },
    });

    const result = await service.createFromPreviewPhones({
      tenantId: 'tenant-1',
      checkType: 'HLR',
      phones: ['+79991111111', '+79992222222'],
      originalFilename: 'test.csv',
      createdByUserId: 'user-1',
      previewId: 'preview-1',
      requestId: 'req-1',
    });

    expect(result.job.id).toBe('job-1');
    expect(createJobWithItems).toHaveBeenCalledTimes(1);
    expect(createJobWithItems.mock.calls[0]![0]).toMatchObject({
      tenantId: 'tenant-1',
      checkType: 'HLR',
      source: 'BULK',
      phones: ['+79991111111', '+79992222222'],
      originalFilename: 'test.csv',
      metadata: { fromPreviewId: 'preview-1' },
    });
    expect(createJobShell).not.toHaveBeenCalled();
    expect(enqueueCsvParse).not.toHaveBeenCalled();
    expect(enqueueSubmitBatch).toHaveBeenCalledTimes(1);
    expect(enqueueSubmitBatch).toHaveBeenCalledWith({
      jobId: 'job-1',
      tenantId: 'tenant-1',
      itemIds: ['item-1', 'item-2'],
      requestId: 'req-1',
    });
  });
});
