/** Public webhook event types (stable contract). */
export const WEBHOOK_EVENTS = {
  CHECK_COMPLETED: 'check.completed',
  CHECK_FAILED: 'check.failed',
  JOB_COMPLETED: 'job.completed',
} as const;

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[keyof typeof WEBHOOK_EVENTS];

export const ALL_WEBHOOK_EVENTS: WebhookEventType[] = Object.values(WEBHOOK_EVENTS);

export function isWebhookEventType(value: string): value is WebhookEventType {
  return (ALL_WEBHOOK_EVENTS as string[]).includes(value);
}

/** Map lifecycle terminal status → public event. */
export function eventForItemStatus(status: 'COMPLETED' | 'FAILED'): WebhookEventType {
  return status === 'COMPLETED'
    ? WEBHOOK_EVENTS.CHECK_COMPLETED
    : WEBHOOK_EVENTS.CHECK_FAILED;
}
