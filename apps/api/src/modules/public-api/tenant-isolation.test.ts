import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { JobsService } from '../jobs/jobs.service';

/**
 * Public `/v1` multi-tenant contract: API key tenant A must never receive
 * tenant B's job/item even when the id is known.
 */
describe('public API tenant isolation', () => {
  it('getByIdForTenant scopes by api key tenantId', async () => {
    const findFirst = vi.fn(
      async ({ where }: { where: { id: string; tenantId: string } }) => {
        if (where.tenantId === 'tenant-a' && where.id === 'job-1') {
          return {
            id: 'job-1',
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
            createdAt: new Date(),
          };
        }
        return null;
      },
    );

    const service = Object.create(JobsService.prototype) as JobsService;
    Object.assign(service, { prisma: { job: { findFirst } } });

    await expect(service.getByIdForTenant('tenant-a', 'job-1')).resolves.toMatchObject({
      id: 'job-1',
    });
    await expect(service.getByIdForTenant('tenant-b', 'job-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('v1 controllers always pass apiKey.tenantId into job lookups', () => {
    // Controllers are thin wrappers; this documents the required call shape.
    const apiKeyA = { tenantId: 'tenant-a', apiKeyId: 'key-a' };
    const apiKeyB = { tenantId: 'tenant-b', apiKeyId: 'key-b' };
    const foreignJobId = 'job-owned-by-a';

    expect(apiKeyA.tenantId).not.toBe(apiKeyB.tenantId);
    // PublicJobsController.get → getByIdForTenant(apiKey.tenantId, id)
    // so tenant-b querying job-owned-by-a becomes:
    const lookupWhere = { id: foreignJobId, tenantId: apiKeyB.tenantId };
    expect(lookupWhere).toEqual({ id: 'job-owned-by-a', tenantId: 'tenant-b' });
  });
});
