import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  CostEstimate,
  EstimateCostInput,
  FetchStatusInput,
  FetchStatusResult,
  NormalizedResult,
  ProviderBalance,
  ProviderCallbackInput,
  ProviderCallbackResult,
  ProviderLogger,
  SubmitCheckInput,
  SubmitCheckResult,
} from '@finenumbers/provider-core';
import { resolveSmscConfig, SmscProvider } from '@finenumbers/provider-smsc';

import { ErrorCodes } from '../../common/errors/error-codes';
import { AppConfigService } from '../../common/config/app-config.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ProviderRequestResponseDto } from './dto/provider-request-response.dto';
import { PrismaProviderPersistence } from './prisma-provider-persistence';
import type {
  ProviderAdapterPort,
  ProviderSendInput,
  ProviderSendResult,
  ProviderStatusResult,
} from './provider-adapter.port';

/**
 * Nest facade over `@finenumbers/provider-smsc`.
 * Controllers / other modules must not call SMSC HTTP directly.
 */
@Injectable()
export class ProviderSmscService implements ProviderAdapterPort {
  readonly code = 'smsc';

  private provider: SmscProvider | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly persistence: PrismaProviderPersistence,
    private readonly appLogger: AppLogger,
  ) {}

  estimateHlrCost(input: EstimateCostInput): Promise<CostEstimate> {
    return this.getProvider().estimateHlrCost(input);
  }

  estimatePingCost(input: EstimateCostInput): Promise<CostEstimate> {
    return this.getProvider().estimatePingCost(input);
  }

  submitHlr(input: SubmitCheckInput): Promise<SubmitCheckResult> {
    return this.getProvider().submitHlr(input);
  }

  submitPing(input: SubmitCheckInput): Promise<SubmitCheckResult> {
    return this.getProvider().submitPing(input);
  }

  fetchStatus(input: FetchStatusInput): Promise<FetchStatusResult> {
    return this.getProvider().fetchStatus(input);
  }

  handleProviderCallback(input: ProviderCallbackInput): Promise<ProviderCallbackResult> {
    return this.getProvider().handleProviderCallback(input);
  }

  mapProviderResponse(input: {
    checkType: 'HLR' | 'PING';
    raw: unknown;
    phoneE164?: string | null;
    providerMessageId?: string | null;
  }): NormalizedResult {
    return this.getProvider().mapProviderResponse(input);
  }

  mapProviderStatus(input: {
    checkType: 'HLR' | 'PING';
    statusCode: string | number | null | undefined;
    errorCode?: string | number | null;
    errorMessage?: string | null;
    phoneE164?: string | null;
    providerMessageId?: string | null;
    extras?: Record<string, unknown>;
  }): NormalizedResult {
    return this.getProvider().mapProviderStatus(input);
  }

  getBalance(correlationId?: string): Promise<ProviderBalance> {
    return this.getProvider().getBalance(correlationId);
  }

  async send(input: ProviderSendInput): Promise<ProviderSendResult> {
    const submitInput: SubmitCheckInput = {
      phoneE164: input.phoneE164,
      idempotencyKey: input.idempotencyKey ?? input.jobItemId,
      tenantId: input.tenantId,
      jobItemId: input.jobItemId,
      correlationId: input.correlationId,
    };
    const result =
      input.checkType === 'HLR'
        ? await this.submitHlr(submitInput)
        : await this.submitPing(submitInput);

    return {
      providerMessageId: result.providerMessageId,
      deduplicated: result.deduplicated,
      normalized: result.normalized,
      rawResponse: result.rawResponse,
    };
  }

  async getStatus(input: {
    providerMessageId: string;
    phoneE164: string;
    checkType: 'HLR' | 'PING';
    tenantId?: string;
    jobItemId?: string;
    correlationId?: string;
  }): Promise<ProviderStatusResult> {
    const result = await this.fetchStatus(input);
    return {
      providerMessageId: result.providerMessageId,
      normalized: result.normalized,
      rawResponse: result.rawResponse,
    };
  }

  getAdapterStatus() {
    const configured = this.hasCredentials();
    return {
      providerCode: this.code,
      adapter: 'smsc' as const,
      configured,
      send: configured ? ('ready' as const) : ('unconfigured' as const),
      status: configured ? ('ready' as const) : ('unconfigured' as const),
      balance: configured ? ('ready' as const) : ('unconfigured' as const),
      baseUrl: this.config.raw.SMSC_BASE_URL,
    };
  }

  /** Recent provider requests (admin/debug) — no raw payloads. */
  async listRecentRequests(limit = 20): Promise<ProviderRequestResponseDto[]> {
    return this.prisma.providerRequest.findMany({
      where: { providerCode: this.code },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
      select: {
        id: true,
        tenantId: true,
        jobItemId: true,
        kind: true,
        status: true,
        providerMessageId: true,
        httpStatus: true,
        createdAt: true,
      },
    });
  }

  private getProvider(): SmscProvider {
    if (this.provider) {
      return this.provider;
    }
    if (!this.hasCredentials()) {
      throw new ServiceUnavailableException({
        errorCode: ErrorCodes.SERVICE_UNAVAILABLE,
        message:
          'SMSC credentials are not configured (set SMSC_API_KEY or SMSC_LOGIN + SMSC_PASSWORD)',
      });
    }

    const logger: ProviderLogger = {
      debug: (message, fields) => this.appLogger.debug({ message, ...fields }, 'ProviderSmsc'),
      info: (message, fields) => this.appLogger.log({ message, ...fields }, 'ProviderSmsc'),
      warn: (message, fields) => this.appLogger.warn({ message, ...fields }, 'ProviderSmsc'),
      error: (message, fields) => this.appLogger.error({ message, ...fields }, 'ProviderSmsc'),
    };

    this.provider = new SmscProvider({
      config: resolveSmscConfig({
        baseUrl: this.config.raw.SMSC_BASE_URL,
        login: this.config.raw.SMSC_LOGIN,
        password: this.config.raw.SMSC_PASSWORD,
        apiKey: this.config.raw.SMSC_API_KEY,
        currency: this.config.raw.SMSC_CURRENCY,
        timeoutMs: this.config.raw.SMSC_TIMEOUT_MS,
        retryMaxAttempts: this.config.raw.SMSC_RETRY_MAX,
        retryBaseDelayMs: this.config.raw.SMSC_RETRY_BASE_DELAY_MS,
        callbackSecret: this.config.raw.SMSC_CALLBACK_SECRET,
      }),
      persistence: this.persistence,
      logger,
    });

    return this.provider;
  }

  private hasCredentials(): boolean {
    const apiKey = this.config.raw.SMSC_API_KEY?.trim();
    const login = this.config.raw.SMSC_LOGIN?.trim();
    const password = this.config.raw.SMSC_PASSWORD;
    return Boolean(apiKey || (login && password));
  }
}
