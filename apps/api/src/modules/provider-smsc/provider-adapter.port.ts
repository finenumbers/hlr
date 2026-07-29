import type {
  CostEstimate,
  EstimateCostInput,
  FetchStatusInput,
  FetchStatusResult,
  NormalizedResult,
  NumberLookupProvider,
  ProviderBalance,
  ProviderCallbackInput,
  ProviderCallbackResult,
  SubmitCheckInput,
  SubmitCheckResult,
} from '@finenumbers/provider-core';

/**
 * Nest DI port for number-lookup providers.
 * Concrete HTTP client + normalizer live in `@finenumbers/provider-smsc`.
 */
export type ProviderSendInput = {
  phoneE164: string;
  checkType: 'HLR' | 'PING';
  jobItemId: string;
  tenantId: string;
  idempotencyKey?: string;
  correlationId?: string;
};

export type ProviderSendResult = {
  providerMessageId: string | null;
  deduplicated: boolean;
  normalized: NormalizedResult;
  rawResponse: unknown;
};

export type ProviderStatusResult = {
  providerMessageId: string;
  normalized: NormalizedResult;
  rawResponse: unknown;
};

/**
 * Application-facing adapter contract used by future jobs/workers.
 * Extends the package port with a few Nest convenience methods.
 */
export abstract class ProviderAdapterPort implements NumberLookupProvider {
  abstract readonly code: string;

  abstract estimateHlrCost(input: EstimateCostInput): Promise<CostEstimate>;
  abstract estimatePingCost(input: EstimateCostInput): Promise<CostEstimate>;
  abstract submitHlr(input: SubmitCheckInput): Promise<SubmitCheckResult>;
  abstract submitPing(input: SubmitCheckInput): Promise<SubmitCheckResult>;
  abstract fetchStatus(input: FetchStatusInput): Promise<FetchStatusResult>;
  abstract handleProviderCallback(
    input: ProviderCallbackInput,
  ): Promise<ProviderCallbackResult>;
  abstract mapProviderResponse(input: {
    checkType: 'HLR' | 'PING';
    raw: unknown;
    phoneE164?: string | null;
    providerMessageId?: string | null;
  }): NormalizedResult;
  abstract mapProviderStatus(input: {
    checkType: 'HLR' | 'PING';
    statusCode: string | number | null | undefined;
    errorCode?: string | number | null;
    errorMessage?: string | null;
    phoneE164?: string | null;
    providerMessageId?: string | null;
    extras?: Record<string, unknown>;
  }): NormalizedResult;
  abstract getBalance(correlationId?: string): Promise<ProviderBalance>;

  /** Convenience wrapper used by upcoming job processors. */
  abstract send(input: ProviderSendInput): Promise<ProviderSendResult>;

  abstract getStatus(input: {
    providerMessageId: string;
    phoneE164: string;
    checkType: 'HLR' | 'PING';
    tenantId?: string;
    jobItemId?: string;
    correlationId?: string;
  }): Promise<ProviderStatusResult>;
}

export const PROVIDER_SMSC = Symbol('PROVIDER_SMSC');
