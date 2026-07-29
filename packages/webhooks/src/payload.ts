import type { WebhookEventType } from './events.js';

/** Stable public envelope version for outbound webhooks. */
export const WEBHOOK_API_VERSION = 'v1' as const;

export type WebhookEnvelopeV1<TData = unknown> = {
  apiVersion: typeof WEBHOOK_API_VERSION;
  /** Unique delivery id — use for client-side dedupe (at-least-once). */
  id: string;
  type: WebhookEventType;
  createdAt: string;
  data: TData;
};

export type CheckWebhookData = {
  jobId: string;
  jobItemId: string;
  checkType: string;
  status: string;
  phoneE164: string;
  resultStatus: string | null;
  isReachable: boolean | null;
  imsi: string | null;
  mcc: string | null;
  mnc: string | null;
  operatorName: string | null;
  countryCode: string | null;
  ported: boolean | null;
  roaming: boolean | null;
  errorCode: string | null;
  errorMessage: string | null;
  completedAt: string | null;
};

export type JobWebhookData = {
  jobId: string;
  checkType: string;
  status: string;
  itemCount: number;
  successCount: number;
  failureCount: number;
  completedAt: string | null;
};

export function buildWebhookEnvelope<TData>(input: {
  id: string;
  type: WebhookEventType;
  createdAt?: Date;
  data: TData;
}): WebhookEnvelopeV1<TData> {
  return {
    apiVersion: WEBHOOK_API_VERSION,
    id: input.id,
    type: input.type,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
    data: input.data,
  };
}

export function serializeWebhookBody(envelope: WebhookEnvelopeV1): string {
  return JSON.stringify(envelope);
}
