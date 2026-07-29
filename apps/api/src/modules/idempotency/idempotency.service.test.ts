import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { IdempotencyService } from './idempotency.service';

function createFakePrisma() {
  const records = new Map<
    string,
    {
      id: string;
      tenantId: string;
      key: string;
      requestHash: string;
      responseCode: number;
      responseBody: unknown;
      expiresAt: Date;
    }
  >();

  const prisma = {
    idempotencyRecord: {
      findUnique: vi.fn(async ({ where }: { where: { tenantId_key: { tenantId: string; key: string } } }) => {
        return records.get(`${where.tenantId_key.tenantId}:${where.tenantId_key.key}`) ?? null;
      }),
      create: vi.fn(async ({ data }: { data: {
        tenantId: string;
        key: string;
        requestHash: string;
        responseCode: number;
        responseBody: unknown;
        expiresAt: Date;
      } }) => {
        const mapKey = `${data.tenantId}:${data.key}`;
        if (records.has(mapKey)) {
          throw Object.assign(new Error('Unique'), { code: 'P2002' });
        }
        const row = { id: `id-${records.size + 1}`, ...data };
        records.set(mapKey, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        for (const [k, v] of records) {
          if (v.id === where.id) {
            const next = { ...v, ...data } as typeof v;
            records.set(k, next);
            return next;
          }
        }
        return null;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        for (const [k, v] of records) {
          if (v.id === where.id) records.delete(k);
        }
      }),
    },
  };

  return { prisma, records };
}

describe('IdempotencyService', () => {
  it('hashes requests stably', () => {
    const { prisma } = createFakePrisma();
    const service = new IdempotencyService(prisma as never);
    const a = service.hashRequest({
      method: 'post',
      path: '/v1/checks',
      body: { phone: '+1', type: 'hlr' },
    });
    const b = service.hashRequest({
      method: 'POST',
      path: '/v1/checks',
      body: { phone: '+1', type: 'hlr' },
    });
    expect(a).toBe(b);
  });

  it('claims key then replays after commit', async () => {
    const { prisma } = createFakePrisma();
    const service = new IdempotencyService(prisma as never);

    const first = await service.beginOrReplay({
      tenantId: 't1',
      key: 'k1',
      requestHash: 'abc',
    });
    expect(first).toEqual({ kind: 'proceed' });

    await service.commit({
      tenantId: 't1',
      key: 'k1',
      requestHash: 'abc',
      responseCode: 202,
      responseBody: { id: 'job_1' },
    });

    const second = await service.beginOrReplay({
      tenantId: 't1',
      key: 'k1',
      requestHash: 'abc',
    });
    expect(second).toEqual({
      kind: 'replay',
      replay: { responseCode: 202, responseBody: { id: 'job_1' } },
    });
  });

  it('conflicts on key reuse with different body', async () => {
    const { prisma } = createFakePrisma();
    const service = new IdempotencyService(prisma as never);

    await service.beginOrReplay({
      tenantId: 't1',
      key: 'k1',
      requestHash: 'abc',
    });
    await service.commit({
      tenantId: 't1',
      key: 'k1',
      requestHash: 'abc',
      responseCode: 202,
      responseBody: {},
    });

    await expect(
      service.beginOrReplay({
        tenantId: 't1',
        key: 'k1',
        requestHash: 'different',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
