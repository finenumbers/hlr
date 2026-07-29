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
  ProviderCheckType,
  ProviderLogger,
  ProviderPersistencePort,
  SubmitCheckInput,
  SubmitCheckResult,
} from '@finenumbers/provider-core';
import {
  ProviderError,
  ProviderIdempotencyConflictError,
} from '@finenumbers/provider-core';

import type { SmscConfig } from './config.js';
import { assertNoSmscError, smscErrorFromBody } from './errors.js';
import { SmscHttpClient } from './http-client.js';
import {
  PROVIDER_CODE,
  callbackDedupeKey,
  mapProviderResponse,
  mapProviderStatus,
  smscClientIdFromKey,
  verifyCallbackSignature,
} from './mapper.js';
import { redactSecrets, toPhoneDigits } from './redact.js';
import type {
  SmscBalanceBody,
  SmscCallbackPayload,
  SmscCostBody,
  SmscSendSuccessBody,
  SmscStatusBody,
} from './types.js';

export type SmscProviderOptions = {
  config: SmscConfig;
  persistence?: ProviderPersistencePort;
  logger?: ProviderLogger;
  http?: SmscHttpClient;
};

/**
 * Production SMSC.ru adapter. No billing / job orchestration.
 */
export class SmscProvider implements NumberLookupProvider {
  readonly code = PROVIDER_CODE;

  private readonly config: SmscConfig;
  private readonly persistence?: ProviderPersistencePort;
  private readonly logger?: ProviderLogger;
  private readonly http: SmscHttpClient;

  constructor(options: SmscProviderOptions) {
    this.config = options.config;
    this.persistence = options.persistence;
    this.logger = options.logger;
    this.http =
      options.http ??
      new SmscHttpClient({
        config: options.config,
        logger: options.logger,
      });
  }

  estimateHlrCost(input: EstimateCostInput): Promise<CostEstimate> {
    return this.estimateCost('HLR', input);
  }

  estimatePingCost(input: EstimateCostInput): Promise<CostEstimate> {
    return this.estimateCost('PING', input);
  }

  submitHlr(input: SubmitCheckInput): Promise<SubmitCheckResult> {
    return this.submit('HLR', input);
  }

  submitPing(input: SubmitCheckInput): Promise<SubmitCheckResult> {
    return this.submit('PING', input);
  }

  async fetchStatus(input: FetchStatusInput): Promise<FetchStatusResult> {
    const phone = toPhoneDigits(input.phoneE164);
    const requestPayload = redactSecrets({
      path: '/sys/status.php',
      phone,
      id: input.providerMessageId,
      all: input.includeDetails === false ? 0 : 2,
      checkType: input.checkType,
    });

    const startedAt = new Date();
    const saved = await this.persistence?.saveRequest({
      tenantId: input.tenantId ?? 'system',
      jobItemId: input.jobItemId ?? null,
      providerCode: this.code,
      kind: 'STATUS',
      status: 'PENDING',
      providerMessageId: input.providerMessageId,
      requestPayload,
      startedAt,
    });

    try {
      const result = await this.http.request<SmscStatusBody>(
        '/sys/status.php',
        {
          phone,
          id: input.providerMessageId,
          all: input.includeDetails === false ? 0 : 2,
        },
        { correlationId: input.correlationId, kind: 'STATUS' },
      );

      assertNoSmscError(result.body, {
        correlationId: input.correlationId,
        httpStatus: result.httpStatus,
      });

      const normalized = this.mapProviderResponse({
        checkType: input.checkType,
        raw: result.body,
        phoneE164: input.phoneE164,
        providerMessageId: input.providerMessageId,
      });

      if (saved) {
        await this.persistence?.updateRequest(saved.id, {
          status: 'SUCCEEDED',
          httpStatus: result.httpStatus,
          responsePayload: redactSecrets(result.body),
          normalizedResult: normalized,
          finishedAt: new Date(),
          providerMessageId: normalized.providerMessageId,
        });
      }

      return {
        providerCode: this.code,
        providerMessageId: input.providerMessageId,
        normalized,
        rawRequest: requestPayload,
        rawResponse: result.body,
        providerRequestId: saved?.id ?? null,
      };
    } catch (error) {
      await this.failRequest(saved?.id, error, {
        checkType: input.checkType,
        phoneE164: input.phoneE164,
        providerMessageId: input.providerMessageId,
      });
      throw error;
    }
  }

  async handleProviderCallback(
    input: ProviderCallbackInput,
  ): Promise<ProviderCallbackResult> {
    const payload = (input.rawPayload ?? {}) as SmscCallbackPayload;
    const checkType = inferCheckType(payload);
    const signatureValid = verifyCallbackSignature({
      payload,
      secret: this.config.callbackSecret,
      signatures: input.signatures,
    });

    if (signatureValid === false) {
      await this.persistence?.saveCallback({
        tenantId: input.tenantId ?? null,
        jobItemId: input.jobItemId ?? null,
        providerCode: this.code,
        providerMessageId: payload.id !== undefined ? String(payload.id) : null,
        rawPayload: redactSecrets(input.rawPayload),
        signatureValid: false,
        dedupeKey: callbackDedupeKey(payload),
        processError: 'Invalid callback signature',
      });

      throw new ProviderError({
        providerCode: this.code,
        kind: 'signature',
        message: 'Invalid SMSC callback signature',
        retryable: false,
        correlationId: input.correlationId,
        rawResponse: redactSecrets(input.rawPayload),
      });
    }

    const normalized = this.mapProviderResponse({
      checkType,
      raw: payload,
      phoneE164: payload.phone !== undefined ? `+${toPhoneDigits(String(payload.phone))}` : null,
      providerMessageId: payload.id !== undefined ? String(payload.id) : null,
    });

    const saved = await this.persistence?.saveCallback({
      tenantId: input.tenantId ?? null,
      jobItemId: input.jobItemId ?? null,
      providerCode: this.code,
      providerMessageId: normalized.providerMessageId,
      rawPayload: redactSecrets(input.rawPayload),
      normalizedResult: normalized,
      signatureValid,
      dedupeKey: callbackDedupeKey(payload),
      processedAt: new Date(),
    });

    this.logger?.info('smsc.callback.normalized', {
      providerMessageId: normalized.providerMessageId,
      lifecycleStatus: normalized.lifecycleStatus,
      resultStatus: normalized.resultStatus,
      signatureValid,
      deduplicated: saved?.deduplicated ?? false,
      correlationId: input.correlationId,
    });

    return {
      providerCode: this.code,
      providerMessageId: normalized.providerMessageId,
      signatureValid,
      deduplicated: saved?.deduplicated ?? false,
      normalized,
      rawPayload: input.rawPayload,
      providerCallbackId: saved?.id ?? null,
    };
  }

  mapProviderResponse(input: {
    checkType: ProviderCheckType;
    raw: unknown;
    phoneE164?: string | null;
    providerMessageId?: string | null;
  }): NormalizedResult {
    return mapProviderResponse({
      ...input,
      currency: this.config.currency,
    });
  }

  mapProviderStatus(input: {
    checkType: ProviderCheckType;
    statusCode: string | number | null | undefined;
    errorCode?: string | number | null;
    errorMessage?: string | null;
    phoneE164?: string | null;
    providerMessageId?: string | null;
    extras?: Record<string, unknown>;
  }): NormalizedResult {
    return mapProviderStatus({
      ...input,
      currency: this.config.currency,
    });
  }

  async getBalance(correlationId?: string): Promise<ProviderBalance> {
    const requestPayload = redactSecrets({ path: '/sys/balance.php' });
    const saved = await this.persistence?.saveRequest({
      tenantId: 'system',
      providerCode: this.code,
      kind: 'BALANCE',
      status: 'PENDING',
      requestPayload,
      startedAt: new Date(),
    });

    try {
      const result = await this.http.request<SmscBalanceBody>(
        '/sys/balance.php',
        {},
        { correlationId, kind: 'BALANCE' },
      );
      assertNoSmscError(result.body, {
        correlationId,
        httpStatus: result.httpStatus,
      });

      const balance = result.body.balance;
      if (balance === undefined || balance === null || balance === '') {
        throw new ProviderError({
          providerCode: this.code,
          kind: 'provider',
          message: 'SMSC balance response missing balance field',
          retryable: false,
          correlationId,
          rawResponse: result.body,
        });
      }

      if (saved) {
        await this.persistence?.updateRequest(saved.id, {
          status: 'SUCCEEDED',
          httpStatus: result.httpStatus,
          responsePayload: redactSecrets(result.body),
          finishedAt: new Date(),
        });
      }

      return {
        providerCode: this.code,
        balance: String(balance),
        currency: this.config.currency,
        rawResponse: result.body,
      };
    } catch (error) {
      await this.failRequest(saved?.id, error);
      throw error;
    }
  }

  private async estimateCost(
    checkType: ProviderCheckType,
    input: EstimateCostInput,
  ): Promise<CostEstimate> {
    const phone = toPhoneDigits(input.phoneE164);
    const flags = checkTypeFlags(checkType);
    const requestPayload = redactSecrets({
      path: '/sys/send.php',
      phones: phone,
      cost: 1,
      ...flags,
      checkType,
    });

    const saved = await this.persistence?.saveRequest({
      tenantId: input.tenantId ?? 'system',
      jobItemId: input.jobItemId ?? null,
      providerCode: this.code,
      kind: 'COST',
      status: 'PENDING',
      requestPayload,
      startedAt: new Date(),
    });

    try {
      const result = await this.http.request<SmscCostBody>(
        '/sys/send.php',
        {
          phones: phone,
          cost: 1,
          ...flags,
        },
        { correlationId: input.correlationId, kind: 'COST' },
      );

      assertNoSmscError(result.body, {
        correlationId: input.correlationId,
        httpStatus: result.httpStatus,
      });

      if (result.body.cost === undefined || result.body.cost === null) {
        throw new ProviderError({
          providerCode: this.code,
          kind: 'provider',
          message: 'SMSC cost response missing cost field',
          retryable: false,
          correlationId: input.correlationId,
          rawResponse: result.body,
        });
      }

      if (saved) {
        await this.persistence?.updateRequest(saved.id, {
          status: 'SUCCEEDED',
          httpStatus: result.httpStatus,
          responsePayload: redactSecrets(result.body),
          finishedAt: new Date(),
        });
      }

      const cnt = result.body.cnt;
      return {
        providerCode: this.code,
        checkType,
        phoneE164: input.phoneE164,
        cost: String(result.body.cost),
        currency: this.config.currency,
        parts: cnt === undefined || cnt === null ? null : Number(cnt),
        rawResponse: result.body,
      };
    } catch (error) {
      await this.failRequest(saved?.id, error);
      throw error;
    }
  }

  private async submit(
    checkType: ProviderCheckType,
    input: SubmitCheckInput,
  ): Promise<SubmitCheckResult> {
    const idempotencyKey = `SEND:${checkType}:${input.idempotencyKey}`;

    if (this.persistence) {
      const latest = await this.persistence.findLatestSendByIdempotencyKey({
        providerCode: this.code,
        tenantId: input.tenantId,
        idempotencyKey,
      });
      if (latest?.status === 'SUCCEEDED') {
        return this.reuseSucceededSend(checkType, input, latest, input.correlationId);
      }
      if (latest?.status === 'PENDING') {
        throw new ProviderError({
          providerCode: this.code,
          kind: 'conflict',
          message: `SMSC send already in flight for key ${idempotencyKey}`,
          retryable: true,
          correlationId: input.correlationId,
        });
      }
      // FAILED (or none) → allow a new attempt with the same key.
    }

    const phone = toPhoneDigits(input.phoneE164);
    const clientId = smscClientIdFromKey(idempotencyKey);
    const flags = checkTypeFlags(checkType);
    const requestPayload = redactSecrets({
      path: '/sys/send.php',
      phones: phone,
      id: clientId,
      ...flags,
      checkType,
      jobItemId: input.jobItemId,
      idempotencyKey,
    });

    let saved: { id: string; deduplicated: boolean } | undefined;
    try {
      saved = await this.persistence?.saveRequest({
        tenantId: input.tenantId,
        jobItemId: input.jobItemId,
        providerCode: this.code,
        kind: 'SEND',
        status: 'PENDING',
        requestPayload,
        idempotencyKey,
        startedAt: new Date(),
      });
    } catch (error) {
      if (error instanceof ProviderIdempotencyConflictError) {
        throw new ProviderError({
          providerCode: this.code,
          kind: 'conflict',
          message: `SMSC send already in flight for key ${idempotencyKey}`,
          retryable: true,
          correlationId: input.correlationId,
          cause: error,
        });
      }
      throw error;
    }

    if (saved?.deduplicated) {
      const existing = await this.persistence?.findSucceededSendByIdempotencyKey({
        providerCode: this.code,
        tenantId: input.tenantId,
        idempotencyKey,
      });
      if (existing) {
        return this.reuseSucceededSend(checkType, input, existing, input.correlationId);
      }
    }

    try {
      const result = await this.http.request<SmscSendSuccessBody>(
        '/sys/send.php',
        {
          phones: phone,
          id: clientId,
          ...flags,
        },
        { correlationId: input.correlationId, kind: 'SEND' },
      );

      if (
        result.body &&
        typeof result.body === 'object' &&
        'error_code' in result.body &&
        (result.body as { error_code?: unknown }).error_code !== undefined
      ) {
        throw smscErrorFromBody(result.body as { error?: string; error_code?: number }, {
          correlationId: input.correlationId,
          httpStatus: result.httpStatus,
        });
      }

      const providerMessageId =
        result.body.id !== undefined && result.body.id !== null
          ? String(result.body.id)
          : null;

      if (!providerMessageId) {
        throw new ProviderError({
          providerCode: this.code,
          kind: 'provider',
          message: 'SMSC send response missing id',
          retryable: false,
          correlationId: input.correlationId,
          rawResponse: result.body,
        });
      }

      const normalized = this.mapProviderResponse({
        checkType,
        raw: result.body,
        phoneE164: input.phoneE164,
        providerMessageId,
      });

      if (saved) {
        await this.persistence?.updateRequest(saved.id, {
          status: 'SUCCEEDED',
          httpStatus: result.httpStatus,
          providerMessageId,
          responsePayload: redactSecrets(result.body),
          normalizedResult: normalized,
          finishedAt: new Date(),
        });
      }

      return {
        providerCode: this.code,
        checkType,
        providerMessageId,
        accepted: true,
        deduplicated: false,
        cost: result.body.cost !== undefined ? String(result.body.cost) : null,
        balance: result.body.balance !== undefined ? String(result.body.balance) : null,
        normalized,
        rawRequest: requestPayload,
        rawResponse: result.body,
        providerRequestId: saved?.id ?? null,
      };
    } catch (error) {
      await this.failRequest(saved?.id, error, {
        checkType,
        phoneE164: input.phoneE164,
      });
      throw error;
    }
  }

  private reuseSucceededSend(
    checkType: ProviderCheckType,
    input: SubmitCheckInput,
    existing: {
      id?: string;
      providerMessageId?: string | null;
      requestPayload: unknown;
      responsePayload?: unknown | null;
    },
    correlationId?: string,
  ): SubmitCheckResult {
    const rawResponse = existing.responsePayload ?? {};
    const normalized = this.mapProviderResponse({
      checkType,
      raw: rawResponse,
      phoneE164: input.phoneE164,
      providerMessageId: existing.providerMessageId,
    });
    this.logger?.info('smsc.submit.deduplicated', {
      checkType,
      jobItemId: input.jobItemId,
      providerMessageId: existing.providerMessageId,
      correlationId,
    });
    return {
      providerCode: this.code,
      checkType,
      providerMessageId: existing.providerMessageId ?? null,
      accepted: true,
      deduplicated: true,
      cost: normalized.cost,
      balance:
        rawResponse && typeof rawResponse === 'object' && 'balance' in rawResponse
          ? String((rawResponse as SmscSendSuccessBody).balance)
          : null,
      normalized,
      rawRequest: existing.requestPayload,
      rawResponse,
      providerRequestId: existing.id ?? null,
    };
  }

  private async failRequest(
    id: string | undefined,
    error: unknown,
    mapping?: {
      checkType: ProviderCheckType;
      phoneE164?: string | null;
      providerMessageId?: string | null;
    },
  ): Promise<void> {
    if (!id || !this.persistence) {
      return;
    }
    const providerError = error instanceof ProviderError ? error : null;
    const rawResponse = providerError?.rawResponse
      ? redactSecrets(providerError.rawResponse)
      : null;
    const normalizedResult =
      mapping && rawResponse
        ? this.mapProviderResponse({
            checkType: mapping.checkType,
            raw: rawResponse,
            phoneE164: mapping.phoneE164,
            providerMessageId: mapping.providerMessageId,
          })
        : null;

    await this.persistence.updateRequest(id, {
      status: 'FAILED',
      httpStatus: providerError?.httpStatus ?? null,
      errorCode:
        providerError?.providerErrorCode !== undefined &&
        providerError?.providerErrorCode !== null
          ? String(providerError.providerErrorCode)
          : (providerError?.kind ?? 'unknown'),
      errorMessage:
        providerError?.message ??
        (error instanceof Error ? error.message : String(error)),
      responsePayload: rawResponse,
      normalizedResult,
      finishedAt: new Date(),
    });
  }
}

function checkTypeFlags(checkType: ProviderCheckType): Record<string, number> {
  return checkType === 'HLR' ? { hlr: 1 } : { ping: 1 };
}

function inferCheckType(payload: SmscCallbackPayload): ProviderCheckType {
  const type = payload.type !== undefined ? Number(payload.type) : NaN;
  // SMSC: 4 = HLR, 5 = Ping-SMS
  if (type === 5) {
    return 'PING';
  }
  if (type === 4) {
    return 'HLR';
  }
  // Default to HLR when unknown — caller can override via jobItem later.
  return 'HLR';
}
