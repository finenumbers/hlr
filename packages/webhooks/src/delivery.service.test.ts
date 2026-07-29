import { describe, expect, it, vi } from 'vitest';

import { WebhookDeliveryService } from './delivery.service.js';
import { verifyWebhookSignature } from './signing.js';

function createFakePrisma(overrides: {
  delivery?: Record<string, unknown>;
  endpoint?: Record<string, unknown>;
}) {
  const endpoint = {
    id: 'ep_1',
    tenantId: 't_1',
    url: 'https://example.test/hooks',
    secret: 'whsec_abc',
    enabled: true,
    events: ['check.completed'],
    consecutiveFailures: 0,
    ...overrides.endpoint,
  };
  const delivery = {
    id: 'del_1',
    tenantId: 't_1',
    endpointId: 'ep_1',
    jobItemId: 'item_1',
    eventType: 'check.completed',
    payload: {
      apiVersion: 'v1',
      id: 'del_1',
      type: 'check.completed',
      createdAt: '2026-01-01T00:00:00.000Z',
      data: { jobItemId: 'item_1' },
    },
    status: 'PENDING',
    attemptCount: 0,
    maxAttempts: 3,
    nextAttemptAt: null,
    lastResponseCode: null,
    lastError: null,
    deliveredAt: null,
    endpoint,
    ...overrides.delivery,
  };

  const updates: unknown[] = [];
  const enqueueCalls: Array<{ deliveryId: string; delayMs?: number }> = [];

  const prisma = {
    platformSettings: {
      findUnique: vi.fn(async () => ({ webhookTimeoutMs: 1000, webhookMaxAttempts: 8 })),
    },
    webhookDelivery: {
      findUnique: vi.fn(async () => delivery),
      update: vi.fn(async ({ data }: { data: unknown }) => {
        updates.push(data);
        Object.assign(delivery, data);
        return delivery;
      }),
      create: vi.fn(),
    },
    webhookEndpoint: {
      findMany: vi.fn(async () => [endpoint]),
      update: vi.fn(async ({ data }: { data: unknown }) => {
        Object.assign(endpoint, data);
        return endpoint;
      }),
    },
    $transaction: vi.fn(async (ops: unknown[]) => {
      await Promise.all(ops as Promise<unknown>[]);
    }),
  };

  const queue = {
    enqueueDeliver: vi.fn(async (payload: { deliveryId: string }, delayMs?: number) => {
      enqueueCalls.push({ deliveryId: payload.deliveryId, delayMs });
    }),
  };

  return { prisma, queue, delivery, endpoint, updates, enqueueCalls };
}

describe('WebhookDeliveryService', () => {
  it('signs outbound requests and marks success', async () => {
    const fake = createFakePrisma({});
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = '';

    const service = new WebhookDeliveryService({
      prisma: fake.prisma as never,
      queue: fake.queue,
      fetchImpl: (async (_url, init) => {
        capturedHeaders = init?.headers as Record<string, string>;
        capturedBody = String(init?.body ?? '');
        return new Response('ok', { status: 200 });
      }) as typeof fetch,
    });

    const result = await service.deliver('del_1');
    expect(result.status).toBe('SUCCEEDED');
    const signatureHeader = capturedHeaders['X-Finenumbers-Signature'];
    expect(signatureHeader).toBeTruthy();
    expect(
      verifyWebhookSignature({
        secret: 'whsec_abc',
        rawBody: capturedBody,
        header: signatureHeader!,
      }),
    ).toBe(true);
    expect(capturedHeaders['X-Finenumbers-Delivery-Id']).toBe('del_1');
  });

  it('retries with backoff on failure', async () => {
    const fake = createFakePrisma({});
    const service = new WebhookDeliveryService({
      prisma: fake.prisma as never,
      queue: fake.queue,
      fetchImpl: (async () => new Response('nope', { status: 500 })) as typeof fetch,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    const result = await service.deliver('del_1');
    expect(result.status).toBe('FAILED');
    expect(fake.enqueueCalls).toHaveLength(1);
    expect(fake.enqueueCalls[0]?.delayMs).toBe(30_000);
  });

  it('marks dead after max attempts', async () => {
    const fake = createFakePrisma({
      delivery: { attemptCount: 2, maxAttempts: 3 },
    });
    const service = new WebhookDeliveryService({
      prisma: fake.prisma as never,
      queue: fake.queue,
      fetchImpl: (async () => new Response('nope', { status: 500 })) as typeof fetch,
    });

    const result = await service.deliver('del_1');
    expect(result.status).toBe('DEAD');
    expect(fake.enqueueCalls).toHaveLength(0);
  });
});
