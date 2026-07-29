import { describe, expect, it, vi } from 'vitest';

import { IdempotencyService } from '../idempotency/idempotency.service';
import { PublicApiService } from './public-api.service';

describe('PublicApiService submit idempotency', () => {
  const apiKey = {
    apiKeyId: 'key-1',
    tenantId: 'tenant-1',
    prefix: 'abcdefghijkl',
    name: 'prod',
    scopes: [] as string[],
    rateLimitRpm: null as number | null,
  };

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

    return {
      records,
      prisma: {
        idempotencyRecord: {
          findUnique: vi.fn(
            async ({
              where,
            }: {
              where: { tenantId_key: { tenantId: string; key: string } };
            }) => {
              return (
                records.get(
                  `${where.tenantId_key.tenantId}:${where.tenantId_key.key}`,
                ) ?? null
              );
            },
          ),
          create: vi.fn(
            async ({
              data,
            }: {
              data: {
                tenantId: string;
                key: string;
                requestHash: string;
                responseCode: number;
                responseBody: unknown;
                expiresAt: Date;
              };
            }) => {
              const mapKey = `${data.tenantId}:${data.key}`;
              if (records.has(mapKey)) {
                throw Object.assign(new Error('Unique'), { code: 'P2002' });
              }
              const row = { id: `rec-${records.size + 1}`, ...data };
              records.set(mapKey, row);
              return row;
            },
          ),
          update: vi.fn(
            async ({
              where,
              data,
            }: {
              where: { id: string };
              data: Record<string, unknown>;
            }) => {
              for (const [k, v] of records) {
                if (v.id === where.id) {
                  const next = { ...v, ...data } as typeof v;
                  records.set(k, next);
                  return next;
                }
              }
              return null;
            },
          ),
          delete: vi.fn(async ({ where }: { where: { id: string } }) => {
            for (const [k, v] of records) {
              if (v.id === where.id) records.delete(k);
            }
          }),
        },
      },
    };
  }

  function createService(opts?: { createImpl?: ReturnType<typeof vi.fn> }) {
    const { prisma } = createFakePrisma();
    let createCalls = 0;
    const createImpl =
      opts?.createImpl ??
      vi.fn(async () => {
        createCalls += 1;
        return {
          job: {
            id: 'job-1',
            checkType: 'HLR',
            status: 'QUEUED',
            itemCount: 1,
            successCount: 0,
            failureCount: 0,
            estimatedCost: null,
            actualCost: null,
            currency: 'RUB',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
          progress: {
            total: 1,
            processed: 0,
            success: 0,
            failed: 0,
            pending: 1,
          },
          deduplicated: createCalls > 1,
        };
      });

    const jobs = { create: createImpl };
    const wallets = {};
    const idempotency = new IdempotencyService(prisma as never);
    const config = {
      rateLimitReadMultiplier: 5,
      rateLimitReadRpmMax: 600,
      rateLimitWebhookRpm: 60,
      rateLimitWebhookMultiplier: 1,
      bodyLimit: '256kb',
      bodyLimitSubmit: '1mb',
    };
    const requestContext = { requestId: 'req-test-1' };
    const service = new PublicApiService(
      prisma as never,
      jobs as never,
      wallets as never,
      idempotency,
      config as never,
      requestContext as never,
    );

    return { service, createImpl };
  }

  it('does not call jobs.create again on replay with same Idempotency-Key', async () => {
    const { service, createImpl } = createService();
    const dto = { phone: '+79991234567', type: 'hlr' as const };

    const first = await service.submitCheck({
      apiKey,
      dto,
      idempotencyKey: 'order-1',
      path: '/v1/checks',
    });
    const second = await service.submitCheck({
      apiKey,
      dto,
      idempotencyKey: 'order-1',
      path: '/v1/checks',
    });

    expect(createImpl).toHaveBeenCalledTimes(1);
    expect(first.body.id).toBe('job-1');
    expect(second.body.id).toBe('job-1');
    expect(second.statusCode).toBe(202);
  });

  it('passes idempotencyKey into jobs.create so DB unique can block a second job', async () => {
    const { service, createImpl } = createService();

    await service.submitCheck({
      apiKey,
      dto: { phone: '+79991234567', type: 'hlr' },
      idempotencyKey: 'order-2',
      path: '/v1/checks',
    });

    expect(createImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        idempotencyKey: 'order-2',
        phones: ['+79991234567'],
      }),
    );
  });

  it('rejects same Idempotency-Key with a different body', async () => {
    const { service } = createService();

    await service.submitCheck({
      apiKey,
      dto: { phone: '+79991234567', type: 'hlr' },
      idempotencyKey: 'order-3',
      path: '/v1/checks',
    });

    await expect(
      service.submitCheck({
        apiKey,
        dto: { phone: '+79997654321', type: 'hlr' },
        idempotencyKey: 'order-3',
        path: '/v1/checks',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'IDEMPOTENCY_KEY_REUSE',
      }),
    });
  });
});
