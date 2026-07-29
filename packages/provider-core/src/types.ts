/**
 * Provider-agnostic check kinds supported by the platform.
 */
export type ProviderCheckType = 'HLR' | 'PING';

/**
 * Lifecycle of a provider operation from the adapter's perspective.
 * Application job status mapping happens outside the adapter.
 */
export type ProviderLifecycleStatus =
  | 'accepted'
  | 'pending'
  | 'completed'
  | 'failed';

/**
 * Stable outcome labels. Keep conservative — only map confident values.
 */
export type ProviderResultStatus =
  | 'reachable'
  | 'unreachable'
  | 'pending'
  | 'error'
  | 'unknown';

/**
 * Normalized, provider-agnostic result used by jobs/billing later.
 * Raw provider payloads are NEVER embedded here — store them separately.
 */
export type NormalizedResult = {
  providerCode: string;
  checkType: ProviderCheckType;
  providerMessageId: string | null;
  phoneE164: string | null;
  lifecycleStatus: ProviderLifecycleStatus;
  resultStatus: ProviderResultStatus;
  isReachable: boolean | null;
  imsi: string | null;
  mcc: string | null;
  mnc: string | null;
  operatorName: string | null;
  countryCode: string | null;
  /** Present when confidently known; otherwise null. */
  ported: boolean | null;
  roaming: boolean | null;
  /** Provider-native error code/text preserved for support/debug. */
  providerErrorCode: string | null;
  providerErrorMessage: string | null;
  /** Provider-native status code (e.g. SMSC status int) as string. */
  providerStatusCode: string | null;
  cost: string | null;
  currency: string | null;
  /**
   * Extra confidently extractable fields that do not warrant top-level keys yet.
   * Must stay JSON-serializable and free of secrets.
   */
  extras: Record<string, unknown>;
};

export type CostEstimate = {
  providerCode: string;
  checkType: ProviderCheckType;
  phoneE164: string;
  cost: string;
  currency: string | null;
  parts: number | null;
  rawResponse: unknown;
};

export type ProviderBalance = {
  providerCode: string;
  balance: string;
  currency: string | null;
  rawResponse: unknown;
};

export type EstimateCostInput = {
  phoneE164: string;
  /** Optional correlation id for logs / request tracing. */
  correlationId?: string;
  tenantId?: string;
  jobItemId?: string;
};

export type SubmitCheckInput = {
  phoneE164: string;
  /**
   * Stable key used for provider-side idempotency (mapped to SMSC `id` when possible)
   * and local dedupe of outbound requests.
   */
  idempotencyKey: string;
  tenantId: string;
  jobItemId: string;
  correlationId?: string;
};

export type SubmitCheckResult = {
  providerCode: string;
  checkType: ProviderCheckType;
  providerMessageId: string | null;
  accepted: boolean;
  /** True when a prior successful submit for the same idempotency key was reused. */
  deduplicated: boolean;
  cost: string | null;
  balance: string | null;
  normalized: NormalizedResult;
  rawRequest: unknown;
  rawResponse: unknown;
  providerRequestId: string | null;
};

export type FetchStatusInput = {
  providerMessageId: string;
  phoneE164: string;
  checkType: ProviderCheckType;
  tenantId?: string;
  jobItemId?: string;
  correlationId?: string;
  /** SMSC `all` flag equivalent — request extended fields when supported. */
  includeDetails?: boolean;
};

export type FetchStatusResult = {
  providerCode: string;
  providerMessageId: string;
  normalized: NormalizedResult;
  rawRequest: unknown;
  rawResponse: unknown;
  providerRequestId: string | null;
};

/**
 * Inbound provider callback / webhook payload (provider-specific shape in `rawPayload`).
 */
export type ProviderCallbackInput = {
  rawPayload: unknown;
  /**
   * Query/body signature fields as received (md5/sha1/crc32).
   * Adapter verifies when a secret is configured.
   */
  signatures?: {
    md5?: string;
    sha1?: string;
    crc32?: string;
  };
  tenantId?: string;
  jobItemId?: string;
  correlationId?: string;
};

export type ProviderCallbackResult = {
  providerCode: string;
  providerMessageId: string | null;
  signatureValid: boolean | null;
  /** True when the same callback fingerprint was already stored. */
  deduplicated: boolean;
  normalized: NormalizedResult;
  rawPayload: unknown;
  providerCallbackId: string | null;
};

export type ProviderLogger = {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
};
