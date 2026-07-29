import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingError,
  BillingService,
  createBillingJobsHooks,
  isBillingError,
  type JobsBillingHooksLike,
} from '@finenumbers/billing';

import { ErrorCodes } from '../../common/errors/error-codes';
import { AppLogger } from '../../common/logger/app-logger.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BillingWorkflowPort } from '../wallets/billing-workflow.port';

/**
 * Nest wrapper around `@finenumbers/billing` + BillingWorkflowPort for DI.
 */
@Injectable()
export class NestBillingService extends BillingWorkflowPort {
  private readonly core: BillingService;
  private readonly hooks: JobsBillingHooksLike;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly logger: AppLogger,
  ) {
    super();
    this.core = new BillingService({
      prisma,
      logger: {
        debug: (message, fields) => this.logger.debug({ message, ...fields }, 'Billing'),
        info: (message, fields) => this.logger.log({ message, ...fields }, 'Billing'),
        warn: (message, fields) => this.logger.warn({ message, ...fields }, 'Billing'),
        error: (message, fields) => this.logger.error({ message, ...fields }, 'Billing'),
      },
      audit: async (input) => {
        await this.audit.write({
          tenantId: input.tenantId,
          actorType: input.actorType,
          actorUserId: input.actorUserId,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId,
          metadata: input.metadata,
        });
      },
    });
    this.hooks = createBillingJobsHooks(this.core, {
      debug: (message, fields) => this.logger.debug({ message, ...fields }, 'Billing'),
      info: (message, fields) => this.logger.log({ message, ...fields }, 'Billing'),
      warn: (message, fields) => this.logger.warn({ message, ...fields }, 'Billing'),
      error: (message, fields) => this.logger.error({ message, ...fields }, 'Billing'),
    });
  }

  getCore(): BillingService {
    return this.core;
  }

  getJobsHooks(): JobsBillingHooksLike {
    return this.hooks;
  }

  override async reserve(input: {
    tenantId: string;
    jobItemId: string;
    amount: string;
    idempotencyKey: string;
  }): Promise<void> {
    try {
      void input.amount;
      await this.core.reserveForJobItem({
        tenantId: input.tenantId,
        jobItemId: input.jobItemId,
        checkType: await this.resolveCheckType(input.jobItemId),
        idempotencyKey: input.idempotencyKey,
      });
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  override async capture(input: {
    jobItemId: string;
    idempotencyKey: string;
  }): Promise<void> {
    try {
      const item = await this.requireJobItem(input.jobItemId);
      await this.core.captureForJobItem({
        tenantId: item.tenantId,
        jobItemId: input.jobItemId,
        idempotencyKey: input.idempotencyKey,
      });
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  override async release(input: {
    jobItemId: string;
    idempotencyKey: string;
  }): Promise<void> {
    try {
      const item = await this.requireJobItem(input.jobItemId);
      await this.core.releaseForJobItem({
        tenantId: item.tenantId,
        jobItemId: input.jobItemId,
        idempotencyKey: input.idempotencyKey,
      });
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  override async topup(input: {
    tenantId: string;
    amount: string;
    description?: string;
    createdById: string;
    idempotencyKey: string;
  }): Promise<void> {
    try {
      await this.core.topup({
        tenantId: input.tenantId,
        amount: input.amount,
        description: input.description,
        createdById: input.createdById,
        idempotencyKey: input.idempotencyKey,
      });
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  async topupIdempotent(input: {
    tenantId: string;
    amount: string;
    description?: string;
    createdById: string;
    idempotencyKey: string;
  }) {
    try {
      return await this.core.topup(input);
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  async adjust(input: {
    tenantId: string;
    amount: string;
    direction: 'credit' | 'debit';
    description?: string;
    createdById: string;
    idempotencyKey: string;
    allowNegative?: boolean;
  }) {
    try {
      return await this.core.adjust(input);
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  async estimate(input: {
    tenantId: string;
    checkType: 'HLR' | 'PING';
    unitCount: number;
  }) {
    try {
      return await this.core.estimate(input);
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  async assertCanAfford(input: {
    tenantId: string;
    checkType: 'HLR' | 'PING';
    unitCount: number;
  }) {
    try {
      return await this.core.assertCanAfford(input);
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  quoteProducts(tenantId: string) {
    return this.core.quoteProducts(tenantId);
  }

  quoteProduct(tenantId: string, checkType: 'HLR' | 'PING') {
    return this.core.quoteProduct(tenantId, checkType);
  }

  assertCanAffordFrozen(input: {
    tenantId: string;
    checkType: 'HLR' | 'PING';
    unitCount: number;
    unitSellPrice: string;
  }) {
    try {
      return this.core.assertCanAffordFrozen(input);
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  inspectProductTariffs(tenantId: string) {
    return this.core.inspectProductTariffs(tenantId);
  }

  async ensureWallet(tenantId: string, currency = 'RUB') {
    return this.core.ensureWallet(tenantId, currency);
  }

  async getBalancesFromLedger(tenantId: string) {
    try {
      return await this.core.getBalancesFromLedger(tenantId);
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  async reconcileWallet(tenantId: string, repair = false) {
    try {
      return await this.core.reconcileWallet(tenantId, { repair });
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  async listLedger(tenantId: string) {
    try {
      return await this.core.listLedger(tenantId);
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  async listLedgerForJobItem(jobItemId: string) {
    try {
      return await this.core.listLedgerForJobItem(jobItemId);
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  async listLedgerForJob(jobId: string) {
    try {
      return await this.core.listLedgerForJob(jobId);
    } catch (error) {
      throw this.toHttp(error);
    }
  }

  private async resolveCheckType(jobItemId: string): Promise<'HLR' | 'PING'> {
    const item = await this.requireJobItem(jobItemId);
    return item.checkType;
  }

  private async requireJobItem(jobItemId: string) {
    const item = await this.prisma.jobItem.findUnique({
      where: { id: jobItemId },
      select: { id: true, tenantId: true, checkType: true },
    });
    if (!item) {
      throw new NotFoundException({
        errorCode: ErrorCodes.NOT_FOUND,
        message: `Job item ${jobItemId} not found`,
      });
    }
    return item;
  }

  private toHttp(error: unknown): never {
    if (!isBillingError(error) && !(error instanceof BillingError)) {
      throw error;
    }
    const billingError = error as BillingError;
    const body = {
      errorCode: mapBillingErrorCode(billingError.code),
      message: billingError.message,
      details: billingError.details,
    };
    switch (billingError.code) {
      case 'INSUFFICIENT_FUNDS':
        throw new HttpException(body, HttpStatus.PAYMENT_REQUIRED);
      case 'WALLET_NOT_FOUND':
      case 'HOLD_NOT_FOUND':
        throw new NotFoundException(body);
      case 'TARIFF_NOT_CONFIGURED':
      case 'INVALID_TARIFF':
      case 'PRICE_SNAPSHOT_MISSING':
      case 'CHECK_TYPE_MISMATCH':
      case 'INVALID_AMOUNT':
      case 'NEGATIVE_BALANCE_FORBIDDEN':
      case 'VALIDATION_FAILED':
        throw new BadRequestException(body);
      case 'CONCURRENT_MODIFICATION':
        throw new ConflictException(body);
      default:
        throw new BadRequestException(body);
    }
  }
}

function mapBillingErrorCode(code: BillingError['code']): string {
  switch (code) {
    case 'INSUFFICIENT_FUNDS':
      return ErrorCodes.INSUFFICIENT_FUNDS;
    case 'TARIFF_NOT_CONFIGURED':
      return ErrorCodes.TARIFF_NOT_CONFIGURED;
    case 'INVALID_TARIFF':
      return ErrorCodes.INVALID_TARIFF;
    case 'PRICE_SNAPSHOT_MISSING':
      return ErrorCodes.PRICE_SNAPSHOT_MISSING;
    case 'CHECK_TYPE_MISMATCH':
      return ErrorCodes.CHECK_TYPE_MISMATCH;
    default:
      return ErrorCodes.VALIDATION_FAILED;
  }
}
