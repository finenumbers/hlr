import { describe, expect, it, vi } from 'vitest';

import { WebhookDeliveryService } from './delivery.service.js';
import { buildWebhookEnvelope } from './payload.js';
import { signWebhookPayload, verifyWebhookSignature } from './signing.js';

/**
 * Contract: reliable webhook infrastructure
 * - HMAC-SHA256 signed
 * - async (queue) delivery — never blocks the producer on HTTP
 * - retry with backoff on failure
 * - at-least-once (stable delivery id for client dedupe)
 */
describe('webhook reliability contract', () => {
  it('signs with HMAC-SHA256 (t=<unix>,v1=<hex>)', () => {
    const rawBody = JSON.stringify(
      buildWebhookEnvelope({
        id: 'del_1',
        type: 'check.completed',
        data: { jobItemId: 'item_1' },
      }),
    );
    const { header } = signWebhookPayload({
      secret: 'whsec_test',
      rawBody,
      timestampSec: 1_700_000_000,
    });
    expect(header).toMatch(/^t=1700000000,v1=[a-f0-9]{64}$/);
    expect(
      verifyWebhookSignature({
        secret: 'whsec_test',
        rawBody,
        header,
        nowSec: 1_700_000_000,
      }),
    ).toBe(true);
  });

  it('enqueues asynchronously and does not HTTP POST in the producer path', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
    const enqueueDeliver = vi.fn(async () => undefined);
    const createdId = 'del_async_1';

    const prisma = {
      platformSettings: {
        findUnique: vi.fn(async () => ({ webhookMaxAttempts: 8 })),
      },
      webhookEndpoint: {
        findMany: vi.fn(async () => [
          {
            id: 'ep_1',
            tenantId: 't_1',
            url: 'https://example.test/hook',
            secret: 'whsec_x',
            enabled: true,
            events: [],
            consecutiveFailures: 0,
          },
        ]),
      },
      webhookDelivery: {
        create: vi.fn(async () => ({ id: createdId })),
        update: vi.fn(async () => ({ id: createdId })),
      },
    };

    const service = new WebhookDeliveryService({
      prisma: prisma as never,
      queue: { enqueueDeliver },
      fetchImpl: fetchImpl as typeof fetch,
    });

    const enqueued = await service.enqueueForEvent({
      tenantId: 't_1',
      eventType: 'check.completed',
      jobItemId: 'item_1',
      data: {
        jobId: 'job_1',
        jobItemId: 'item_1',
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
      },
    });

    expect(enqueued).toBe(1);
    expect(enqueueDeliver).toHaveBeenCalledWith({ deliveryId: createdId });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('retries failed deliveries with backoff (does not stop at first failure)', async () => {
    const delivery = {
      id: 'del_retry',
      tenantId: 't_1',
      endpointId: 'ep_1',
      jobItemId: 'item_1',
      eventType: 'check.completed',
      payload: buildWebhookEnvelope({
        id: 'del_retry',
        type: 'check.completed',
        data: { jobItemId: 'item_1' },
      }),
      status: 'PENDING',
      attemptCount: 0,
      maxAttempts: 5,
      nextAttemptAt: null,
      lastResponseCode: null,
      lastError: null,
      deliveredAt: null,
      endpoint: {
        id: 'ep_1',
        tenantId: 't_1',
        url: 'https://example.test/hook',
        secret: 'whsec_x',
        enabled: true,
        events: [],
        consecutiveFailures: 0,
      },
    };

    const enqueueCalls: Array<{ delayMs?: number }> = [];
    const prisma = {
      platformSettings: {
        findUnique: vi.fn(async () => ({ webhookTimeoutMs: 1000 })),
      },
      webhookDelivery: {
        findUnique: vi.fn(async () => delivery),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(delivery, data);
          return delivery;
        }),
      },
      webhookEndpoint: {
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(delivery.endpoint, data);
          return delivery.endpoint;
        }),
      },
      $transaction: vi.fn(async (ops: unknown[]) => {
        await Promise.all(ops as Promise<unknown>[]);
      }),
    };

    const service = new WebhookDeliveryService({
      prisma: prisma as never,
      queue: {
        enqueueDeliver: async (_payload, delayMs) => {
          enqueueCalls.push({ delayMs });
        },
      },
      fetchImpl: (async () => new Response('err', { status: 503 })) as typeof fetch,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    const result = await service.deliver('del_retry');
    expect(result.status).toBe('FAILED');
    expect(delivery.attemptCount).toBe(1);
    expect(enqueueCalls).toHaveLength(1);
    expect(enqueueCalls[0]?.delayMs).toBeGreaterThan(0);

    // Second failure still schedules another retry (at-least-once until success or dead).
    const result2 = await service.deliver('del_retry');
    expect(result2.status).toBe('FAILED');
    expect(delivery.attemptCount).toBe(2);
    expect(enqueueCalls).toHaveLength(2);
  });

  it('uses stable delivery id for at-least-once client dedupe', async () => {
    const deliveryId = 'del_stable_42';
    const envelope = buildWebhookEnvelope({
      id: deliveryId,
      type: 'job.completed',
      data: { jobId: 'job_1', status: 'COMPLETED' },
    });
    // Clients must dedupe by envelope.id — retries reuse the same delivery row/id.
    expect(envelope.id).toBe(deliveryId);
    expect(envelope.apiVersion).toBe('v1');

    const delivery = {
      id: deliveryId,
      tenantId: 't_1',
      endpointId: 'ep_1',
      jobItemId: null,
      eventType: 'job.completed',
      payload: envelope,
      status: 'PENDING',
      attemptCount: 0,
      maxAttempts: 3,
      nextAttemptAt: null,
      lastResponseCode: null,
      lastError: null,
      deliveredAt: null,
      endpoint: {
        id: 'ep_1',
        tenantId: 't_1',
        url: 'https://example.test/hook',
        secret: 'whsec_x',
        enabled: true,
        events: [],
        consecutiveFailures: 0,
      },
    };

    const seenIds: string[] = [];
    const prisma = {
      platformSettings: {
        findUnique: vi.fn(async () => ({ webhookTimeoutMs: 1000 })),
      },
      webhookDelivery: {
        findUnique: vi.fn(async () => delivery),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(delivery, data);
          return delivery;
        }),
      },
      webhookEndpoint: {
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(delivery.endpoint, data);
          return delivery.endpoint;
        }),
      },
      $transaction: vi.fn(async (ops: unknown[]) => {
        await Promise.all(ops as Promise<unknown>[]);
      }),
    };

    const service = new WebhookDeliveryService({
      prisma: prisma as never,
      queue: { enqueueDeliver: async () => undefined },
      fetchImpl: (async (_url, init) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { id: string };
        seenIds.push(body.id);
        // First attempt: timeout-style failure after client may have processed → retry.
        if (seenIds.length === 1) {
          return new Response('timeout', { status: 504 });
        }
        return new Response('ok', { status: 200 });
      }) as typeof fetch,
    });

    await service.deliver(deliveryId);
    await service.deliver(deliveryId);

    expect(seenIds).toEqual([deliveryId, deliveryId]);
    expect(delivery.status).toBe('SUCCEEDED');
  });
});
