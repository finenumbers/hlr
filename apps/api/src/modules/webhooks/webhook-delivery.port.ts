/**
 * Extension point for webhook delivery workers (E13).
 */
export abstract class WebhookDeliveryPort {
  abstract enqueueDelivery(deliveryId: string): Promise<void>;

  abstract enqueueForEvent(input: {
    tenantId: string;
    eventType: string;
    jobItemId?: string;
    payload: unknown;
  }): Promise<void>;
}

export const WEBHOOK_DELIVERY = Symbol('WEBHOOK_DELIVERY');
