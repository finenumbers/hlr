export const WEBHOOK_QUEUE_NAMES = {
  WEBHOOKS_DELIVER: 'webhooks-deliver',
} as const;

export const WEBHOOK_QUEUE_JOB_NAMES = {
  DELIVER: 'deliver',
} as const;

export type WebhookDeliverPayload = {
  deliveryId: string;
};

export const WEBHOOK_QUEUE_DEFAULT_JOB_OPTIONS = {
  deliver: {
    attempts: 1,
    removeOnComplete: { count: 2_000 },
    removeOnFail: { count: 5_000 },
  },
} as const;

/** Consecutive HTTP failures before auto-disabling an endpoint. */
export const WEBHOOK_AUTO_DISABLE_AFTER = 20;
