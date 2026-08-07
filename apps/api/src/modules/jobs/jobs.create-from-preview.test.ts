import { describe, expect, it, vi } from 'vitest';

import { JobsService } from './jobs.service';

describe('JobsService.createFromPreviewPhones', () => {
  it('uses CreateJobService.create (same path as paste) with maxCsvRows override', async () => {
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

    const create = vi.fn(async () => ({
      job,
      deduplicated: false,
      deduplicatedPhoneCount: 0,
      workUnits: 2,
      batchesEnqueued: 1,
    }));

    const service = Object.create(JobsService.prototype) as JobsService;
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
      createJobService: { create },
      store: { deleteJobCascade: vi.fn() },
      processor: {},
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
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0]).toMatchObject({
      tenantId: 'tenant-1',
      checkType: 'HLR',
      source: 'BULK',
      phones: ['+79991111111', '+79992222222'],
      originalFilename: 'test.csv',
      metadata: { fromPreviewId: 'preview-1' },
      runtimeSettings: { maxBatchPhones: 100_000 },
      requestId: 'req-1',
    });
  });
});
