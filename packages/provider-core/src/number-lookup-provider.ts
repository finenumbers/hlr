import type {
  CostEstimate,
  EstimateCostInput,
  FetchStatusInput,
  FetchStatusResult,
  NormalizedResult,
  ProviderBalance,
  ProviderCallbackInput,
  ProviderCallbackResult,
  SubmitCheckInput,
  SubmitCheckResult,
} from './types.js';

/**
 * Port for number-lookup providers (SMSC today, others later).
 *
 * Implementations MUST:
 * - keep billing / job orchestration out of scope;
 * - return NormalizedResult without embedding raw payloads;
 * - preserve original provider error codes/messages on failures;
 * - route all HTTP to the external provider through this port only.
 */
export interface NumberLookupProvider {
  readonly code: string;

  estimateHlrCost(input: EstimateCostInput): Promise<CostEstimate>;
  estimatePingCost(input: EstimateCostInput): Promise<CostEstimate>;

  submitHlr(input: SubmitCheckInput): Promise<SubmitCheckResult>;
  submitPing(input: SubmitCheckInput): Promise<SubmitCheckResult>;

  fetchStatus(input: FetchStatusInput): Promise<FetchStatusResult>;

  handleProviderCallback(input: ProviderCallbackInput): Promise<ProviderCallbackResult>;

  /**
   * Map a raw provider response (send/status/callback body) into NormalizedResult.
   * Prefer shared pipeline used by fetchStatus + handleProviderCallback.
   */
  mapProviderResponse(input: {
    checkType: 'HLR' | 'PING';
    raw: unknown;
    phoneE164?: string | null;
    providerMessageId?: string | null;
  }): NormalizedResult;

  /** Map provider-native status code/text into lifecycle/result fields. */
  mapProviderStatus(input: {
    checkType: 'HLR' | 'PING';
    statusCode: string | number | null | undefined;
    errorCode?: string | number | null;
    errorMessage?: string | null;
    phoneE164?: string | null;
    providerMessageId?: string | null;
    extras?: Record<string, unknown>;
  }): NormalizedResult;

  /** Optional helper used by admin health widgets. */
  getBalance?(correlationId?: string): Promise<ProviderBalance>;
}

/** DI token for Nest / future containers. */
export const NUMBER_LOOKUP_PROVIDER = Symbol('NUMBER_LOOKUP_PROVIDER');
