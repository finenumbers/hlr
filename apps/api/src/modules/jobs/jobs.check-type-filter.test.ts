import { describe, expect, it, vi } from 'vitest';

import { JobsService } from './jobs.service';

/**
 * History rendering: list endpoints must filter by checkType so HLR/Ping
 * job history are separable (cabinet / admin / public).
 */
describe('JobsService.listByTenant checkType filter', () => {
  it('passes checkType into Prisma where (HLR vs PING)', async () => {
    const findMany = vi.fn(async () => []);
    const count = vi.fn(async () => 0);
    const prisma = {
      job: { findMany, count },
      $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    };

    const service = Object.create(JobsService.prototype) as JobsService;
    Object.assign(service, { prisma });

    await service.listByTenant('tenant-1', 1, 20, { checkType: 'PING' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-1', checkType: 'PING' },
      }),
    );

    await service.listByTenant('tenant-1', 1, 20, { checkType: 'HLR', status: 'COMPLETED' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'tenant-1',
          status: 'COMPLETED',
          checkType: 'HLR',
        },
      }),
    );

    await service.listByTenant('tenant-1', 1, 20, {});
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-1' },
      }),
    );
  });
});
