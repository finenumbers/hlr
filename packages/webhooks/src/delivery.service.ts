import type { PrismaClient, WebhookDeliveryStatus } from '@finenumbers/db';

import { computeNextAttemptAt, webhookRetryDelayMs } from './backoff.js';
import { isWebhookEventType, type WebhookEventType } from './events.js';
import {
  buildWebhookEnvelope,
  serializeWebhookBody,
  type CheckWebhookData,
  type JobWebhookData,
} from './payload.js';
import { WEBHOOK_AUTO_DISABLE_AFTER, type WebhookDeliverPayload } from './queue.js';
import { signWebhookPayload } from './signing.js';

export type WebhooksLogger = {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
};

export type WebhookQueuePublisher = {
  enqueueDeliver(payload: WebhookDeliverPayload, delayMs?: number): Promise<void>;
};

export type WebhookDeliveryServiceDeps = {
  prisma: PrismaClient;
  queue: WebhookQueuePublisher;
  logger?: WebhooksLogger;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

const silentLogger: WebhooksLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

type EndpointRow = {
  id: string;
  tenantId: string;
  url: string;
  secret: string;
  enabled: boolean;
  events: string[];
  consecutiveFailures: number;
};

/**
 * Fan-out + HTTP delivery with DB-backed attempts and exponential retry.
 * At-least-once: clients must dedupe by envelope `id` (delivery id).
 */
export class WebhookDeliveryService {
  private readonly logger: WebhooksLogger;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly deps: WebhookDeliveryServiceDeps) {
    this.logger = deps.logger ?? silentLogger;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.now = deps.now ?? (() => new Date());
  }

  async enqueueForEvent(input: {
    tenantId: string;
    eventType: WebhookEventType;
    jobItemId?: string | null;
    data: CheckWebhookData | JobWebhookData;
  }): Promise<number> {
    if (!isWebhookEventType(input.eventType)) {
      this.logger.warn('webhooks.enqueue.unknown_event', { eventType: input.eventType });
      return 0;
    }

    const endpoints = await this.deps.prisma.webhookEndpoint.findMany({
      where: { tenantId: input.tenantId, enabled: true },
      select: {
        id: true,
        tenantId: true,
        url: true,
        secret: true,
        enabled: true,
        events: true,
        consecutiveFailures: true,
      },
    });

    const matching = endpoints.filter(
      (ep) => ep.events.length === 0 || ep.events.includes(input.eventType),
    );
    if (matching.length === 0) {
      return 0;
    }

    const settings = await this.deps.prisma.platformSettings.findUnique({
      where: { id: 'default' },
      select: { webhookMaxAttempts: true },
    });
    const maxAttempts = settings?.webhookMaxAttempts ?? 8;

    let enqueued = 0;
    for (const endpoint of matching) {
      // Placeholder id — replaced after create so envelope.id === delivery.id.
      const provisionalId = `pending-${endpoint.id}`;
      const envelope = buildWebhookEnvelope({
        id: provisionalId,
        type: input.eventType,
        createdAt: this.now(),
        data: input.data,
      });

      const delivery = await this.deps.prisma.webhookDelivery.create({
        data: {
          tenantId: input.tenantId,
          endpointId: endpoint.id,
          jobItemId: input.jobItemId ?? null,
          eventType: input.eventType,
          payload: envelope as object,
          status: 'PENDING',
          maxAttempts,
          nextAttemptAt: this.now(),
        },
      });

      // Patch envelope id to delivery id for client dedupe.
      const finalEnvelope = { ...envelope, id: delivery.id };
      await this.deps.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { payload: finalEnvelope as object },
      });

      await this.deps.queue.enqueueDeliver({ deliveryId: delivery.id });
      enqueued += 1;
      this.logger.info('webhooks.enqueue.created', {
        deliveryId: delivery.id,
        tenantId: input.tenantId,
        endpointId: endpoint.id,
        eventType: input.eventType,
        jobId: input.data.jobId,
        ...(input.jobItemId ? { jobItemId: input.jobItemId } : {}),
      });
    }
    return enqueued;
  }

  async deliver(deliveryId: string): Promise<{ status: WebhookDeliveryStatus }> {
    const delivery = await this.deps.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        endpoint: true,
      },
    });
    if (!delivery) {
      this.logger.warn('webhooks.deliver.missing', { deliveryId });
      return { status: 'FAILED' };
    }
    if (delivery.status === 'SUCCEEDED' || delivery.status === 'DEAD') {
      return { status: delivery.status };
    }
    if (!delivery.endpoint.enabled) {
      await this.deps.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'DEAD',
          lastError: 'Endpoint disabled',
        },
      });
      return { status: 'DEAD' };
    }

    const settings = await this.deps.prisma.platformSettings.findUnique({
      where: { id: 'default' },
      select: { webhookTimeoutMs: true },
    });
    const timeoutMs = settings?.webhookTimeoutMs ?? 5_000;

    await this.deps.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'DELIVERING' },
    });

    const rawBody = serializeWebhookBody(
      delivery.payload as Parameters<typeof serializeWebhookBody>[0],
    );
    const { header } = signWebhookPayload({
      secret: delivery.endpoint.secret,
      rawBody,
    });

    const attemptCount = delivery.attemptCount + 1;
    let responseCode: number | null = null;
    let errorMessage: string | null = null;
    let ok = false;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await this.fetchImpl(delivery.endpoint.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': 'Finenumbers-Webhooks/1.0',
            'X-Finenumbers-Signature': header,
            'X-Finenumbers-Delivery-Id': delivery.id,
            'X-Finenumbers-Event': delivery.eventType,
          },
          body: rawBody,
          signal: controller.signal,
        });
        responseCode = response.status;
        ok = response.status >= 200 && response.status < 300;
        if (!ok) {
          const text = await response.text().catch(() => '');
          errorMessage = `HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`;
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    if (ok) {
      await this.deps.prisma.$transaction([
        this.deps.prisma.webhookDelivery.update({
          where: { id: deliveryId },
          data: {
            status: 'SUCCEEDED',
            attemptCount,
            lastResponseCode: responseCode,
            lastError: null,
            deliveredAt: this.now(),
            nextAttemptAt: null,
          },
        }),
        this.deps.prisma.webhookEndpoint.update({
          where: { id: delivery.endpointId },
          data: { consecutiveFailures: 0 },
        }),
      ]);
      this.logger.info('webhooks.deliver.succeeded', {
        deliveryId,
        tenantId: delivery.tenantId,
        endpointId: delivery.endpointId,
        jobItemId: delivery.jobItemId,
        attemptCount,
        responseCode,
      });
      return { status: 'SUCCEEDED' };
    }

    const dead = attemptCount >= delivery.maxAttempts;
    const nextAttemptAt = dead
      ? null
      : computeNextAttemptAt({
          attemptCount,
          maxAttempts: delivery.maxAttempts,
          now: this.now(),
        });
    const status: WebhookDeliveryStatus = dead ? 'DEAD' : 'FAILED';

    const endpoint = delivery.endpoint as EndpointRow;
    const consecutiveFailures = endpoint.consecutiveFailures + 1;
    const shouldDisable = consecutiveFailures >= WEBHOOK_AUTO_DISABLE_AFTER;

    await this.deps.prisma.$transaction([
      this.deps.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status,
          attemptCount,
          lastResponseCode: responseCode,
          lastError: errorMessage,
          nextAttemptAt,
        },
      }),
      this.deps.prisma.webhookEndpoint.update({
        where: { id: delivery.endpointId },
        data: {
          consecutiveFailures,
          ...(shouldDisable ? { enabled: false } : {}),
        },
      }),
    ]);

    this.logger.warn('webhooks.deliver.failed', {
      deliveryId,
      tenantId: delivery.tenantId,
      endpointId: delivery.endpointId,
      jobItemId: delivery.jobItemId,
      attemptCount,
      status,
      responseCode,
      // Truncated already; logger sanitize redacts secrets/phones in free text.
      errorMessage: errorMessage?.slice(0, 200),
      disabled: shouldDisable,
    });

    if (!dead && nextAttemptAt) {
      const delayMs = Math.max(0, nextAttemptAt.getTime() - this.now().getTime());
      await this.deps.queue.enqueueDeliver({ deliveryId }, delayMs);
    }

    return { status };
  }

  /** Expose backoff helper for tests / scheduling visibility. */
  static retryDelayMs(attemptCount: number): number {
    return webhookRetryDelayMs(attemptCount);
  }
}
