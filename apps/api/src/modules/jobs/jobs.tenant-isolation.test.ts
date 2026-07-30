import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { JobsService } from './jobs.service';

/**
 * Critical multi-tenant contract: knowing a job/item id must not reveal
 * another tenant's data. All public lookups go through *ForTenant helpers.
 */
describe('JobsService tenant isolation', () => {
  const jobA = {
    id: 'job-a',
    tenantId: 'tenant-a',
    checkType: 'HLR',
    source: 'API',
    status: 'QUEUED',
    itemCount: 1,
    successCount: 0,
    failureCount: 0,
    estimatedCost: null,
    actualCost: null,
    currency: 'RUB',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const itemA = {
    id: 'item-a',
    jobId: 'job-a',
    tenantId: 'tenant-a',
    checkType: 'HLR',
    status: 'COMPLETED',
    phoneE164: '+79991234567',
    resultStatus: 'reachable',
    isReachable: true,
    imsi: null,
    mcc: null,
    mnc: null,
    operatorName: null,
    countryCode: null,
    ported: null,
    roaming: null,
    errorCode: null,
    errorMessage: null,
    completedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    normalizedResult: {
      extras: { msc: '79001112233', region: 'Moscow' },
    },
  };

  function createService() {
    const prisma = {
      job: {
        findFirst: vi.fn(
          async ({
            where,
          }: {
            where: { id: string; tenantId: string };
          }) => {
            if (where.id === jobA.id && where.tenantId === jobA.tenantId) {
              return jobA;
            }
            return null;
          },
        ),
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0),
      },
      jobItem: {
        findFirst: vi.fn(
          async ({
            where,
          }: {
            where: { id: string; tenantId: string };
          }) => {
            if (where.id === itemA.id && where.tenantId === itemA.tenantId) {
              return itemA;
            }
            return null;
          },
        ),
        findMany: vi.fn(async () => [itemA]),
        count: vi.fn(async () => 1),
      },
      $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    };

    // Construct without full Nest deps — only exercise tenant-scoped methods via prototype bind.
    const service = Object.create(JobsService.prototype) as JobsService;
    Object.assign(service, { prisma });
    return { service, prisma };
  }

  it('owner tenant can read its job by id', async () => {
    const { service } = createService();
    const job = await service.getByIdForTenant('tenant-a', 'job-a');
    expect(job.id).toBe('job-a');
  });

  it('other tenant cannot read job by the same id (404)', async () => {
    const { service, prisma } = createService();
    await expect(service.getByIdForTenant('tenant-b', 'job-a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.job.findFirst).toHaveBeenCalledWith({
      where: { id: 'job-a', tenantId: 'tenant-b' },
    });
  });

  it('other tenant cannot read job item by id (404)', async () => {
    const { service, prisma } = createService();
    await expect(service.getItemForTenant('tenant-b', 'item-a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.jobItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'item-a', tenantId: 'tenant-b' },
      }),
    );
  });

  it('listItemsForTenant 404s when job belongs to another tenant', async () => {
    const { service } = createService();
    await expect(
      service.listItemsForTenant({
        tenantId: 'tenant-b',
        jobId: 'job-a',
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('listItemsForTenant coerces string page/pageSize (broken Query DTO metatype)', async () => {
    const { service, prisma } = createService();
    const result = await service.listItemsForTenant({
      tenantId: 'tenant-a',
      jobId: 'job-a',
      // Query strings arrive as strings when ValidationPipe skips intersection types.
      page: '1' as unknown as number,
      pageSize: '20' as unknown as number,
    });

    expect(result.items).toHaveLength(1);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.items[0]?.msc).toBe('79001112233');
    expect(result.items[0]?.region).toBe('Moscow');
    expect(prisma.jobItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 20,
      }),
    );
  });

  it('findJobIdForTenant returns null across tenants', async () => {
    const { service } = createService();
    await expect(service.findJobIdForTenant('tenant-a', 'job-a')).resolves.toBe('job-a');
    await expect(service.findJobIdForTenant('tenant-b', 'job-a')).resolves.toBeNull();
  });
});
