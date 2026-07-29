import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  computeProgress,
  CreateJobService,
  JobLifecycleService,
  JobsNotFoundError,
  JobsValidationError,
  PrismaJobsStore,
  type ApplyProviderUpdateInput,
  type ApplyProviderUpdateResult,
  type CreateJobResult,
  type JobProgress,
} from '@finenumbers/jobs';
import { createJobsWebhookHooks } from '@finenumbers/webhooks';
import type { NormalizedResult } from '@finenumbers/provider-core';

import type { PaginatedResult } from '../../common/dto/pagination-query.dto';
import { ErrorCodes } from '../../common/errors/error-codes';
import { AppLogger } from '../../common/logger/app-logger.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NestBillingService } from '../billing/billing.service';
import { PROVIDER_SMSC } from '../provider-smsc/provider-adapter.port';
import type { ProviderSmscService } from '../provider-smsc/provider-smsc.service';
import { NestWebhookDeliveryService } from '../webhooks/nest-webhook-delivery.service';
import type { CreateJobDto } from './dto/create-job.dto';
import type { JobResponseDto } from './dto/job-response.dto';
import { JOBS_PROCESSOR, JobsProcessorPort } from './jobs-processor.port';

@Injectable()
export class JobsService {
  private readonly store: PrismaJobsStore;
  private readonly createJobService: CreateJobService;
  private readonly lifecycleService: JobLifecycleService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLogger,
    private readonly billing: NestBillingService,
    private readonly webhookDelivery: NestWebhookDeliveryService,
    @Inject(JOBS_PROCESSOR) private readonly processor: JobsProcessorPort,
    @Inject(PROVIDER_SMSC) provider: ProviderSmscService,
  ) {
    this.store = new PrismaJobsStore(prisma);
    const jobsLogger = {
      debug: (message: string, fields?: Record<string, unknown>) =>
        this.logger.debug({ message, ...fields }, 'Jobs'),
      info: (message: string, fields?: Record<string, unknown>) =>
        this.logger.log({ message, ...fields }, 'Jobs'),
      warn: (message: string, fields?: Record<string, unknown>) =>
        this.logger.warn({ message, ...fields }, 'Jobs'),
      error: (message: string, fields?: Record<string, unknown>) =>
        this.logger.error({ message, ...fields }, 'Jobs'),
    };
    this.createJobService = new CreateJobService({
      store: this.store,
      queue: this.processor,
      logger: jobsLogger,
    });
    // Webhook core is ready after NestWebhookDeliveryService.onModuleInit.
    let hooksCache: ReturnType<typeof createJobsWebhookHooks> | null = null;
    const webhookHooks = {
      onItemTerminal: async (input: Parameters<
        ReturnType<typeof createJobsWebhookHooks>['onItemTerminal']
      >[0]) => {
        hooksCache ??= createJobsWebhookHooks(
          this.webhookDelivery.getCore(),
          this.prisma,
          jobsLogger,
        );
        return hooksCache.onItemTerminal(input);
      },
      onJobFinalized: async (input: Parameters<
        ReturnType<typeof createJobsWebhookHooks>['onJobFinalized']
      >[0]) => {
        hooksCache ??= createJobsWebhookHooks(
          this.webhookDelivery.getCore(),
          this.prisma,
          jobsLogger,
        );
        return hooksCache.onJobFinalized(input);
      },
    };
    this.lifecycleService = new JobLifecycleService({
      store: this.store,
      queue: this.processor,
      provider,
      billing: this.billing.getJobsHooks(),
      webhooks: webhookHooks,
      logger: jobsLogger,
    });
  }

  getProcessor(): JobsProcessorPort {
    return this.processor;
  }

  /** Used by future SMSC callback controller (E09). */
  getLifecycle(): JobLifecycleService {
    return this.lifecycleService;
  }

  async listByTenant(
    tenantId: string,
    page: number,
    pageSize: number,
    filters?: {
      status?: string;
      checkType?: string;
      sort?: 'createdAt' | '-createdAt';
    },
  ): Promise<PaginatedResult<JobResponseDto>> {
    const skip = (page - 1) * pageSize;
    const where = {
      tenantId,
      ...(filters?.status
        ? {
            status: filters.status as
              | 'QUEUED'
              | 'PROCESSING'
              | 'COMPLETED'
              | 'COMPLETED_WITH_ERRORS'
              | 'FAILED'
              | 'CANCELLED',
          }
        : {}),
      ...(filters?.checkType
        ? { checkType: filters.checkType as 'HLR' | 'PING' }
        : {}),
    };
    const orderBy =
      filters?.sort === 'createdAt'
        ? { createdAt: 'asc' as const }
        : { createdAt: 'desc' as const };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.job.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
      }),
      this.prisma.job.count({ where }),
    ]);

    return {
      items: rows.map(mapJob),
      page,
      pageSize,
      total,
    };
  }

  /**
   * @deprecated Unscoped lookup — do not use for client-facing APIs.
   * Prefer {@link getByIdForTenant}. Kept for internal lifecycle helpers only.
   */
  async getById(id: string): Promise<JobResponseDto & { progress: JobProgress }> {
    const job = await this.store.findJobById(id);
    if (!job) {
      throw new NotFoundException({
        errorCode: ErrorCodes.NOT_FOUND,
        message: `Job ${id} not found`,
      });
    }
    return {
      ...mapJob(job),
      progress: computeProgress(job),
    };
  }

  /** Tenant-scoped job fetch — returns 404 for cross-tenant ids (no existence leak detail). */
  async getByIdForTenant(
    tenantId: string,
    id: string,
  ): Promise<JobResponseDto & { progress: JobProgress }> {
    const job = await this.prisma.job.findFirst({
      where: { id, tenantId },
    });
    if (!job) {
      throw new NotFoundException({
        errorCode: ErrorCodes.NOT_FOUND,
        message: `Job ${id} not found`,
      });
    }
    return {
      ...mapJob(job),
      progress: computeProgress(job),
    };
  }

  async findJobIdForTenant(tenantId: string, id: string): Promise<string | null> {
    const job = await this.prisma.job.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    return job?.id ?? null;
  }

  async listItemsForTenant(input: {
    tenantId: string;
    jobId: string;
    page: number;
    pageSize: number;
    status?: string;
  }): Promise<
    PaginatedResult<{
      id: string;
      jobId: string;
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
      completedAt: Date | null;
      createdAt: Date;
    }>
  > {
    await this.getByIdForTenant(input.tenantId, input.jobId);
    const skip = (input.page - 1) * input.pageSize;
    const where = {
      tenantId: input.tenantId,
      jobId: input.jobId,
      ...(input.status
        ? {
            status: input.status as
              | 'QUEUED'
              | 'RESERVED'
              | 'SENT'
              | 'PENDING'
              | 'COMPLETED'
              | 'FAILED'
              | 'CANCELLED',
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.jobItem.findMany({
        where,
        skip,
        take: input.pageSize,
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          jobId: true,
          checkType: true,
          status: true,
          phoneE164: true,
          resultStatus: true,
          isReachable: true,
          imsi: true,
          mcc: true,
          mnc: true,
          operatorName: true,
          countryCode: true,
          ported: true,
          roaming: true,
          errorCode: true,
          errorMessage: true,
          completedAt: true,
          createdAt: true,
        },
      }),
      this.prisma.jobItem.count({ where }),
    ]);

    return {
      items,
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async getItemForTenant(
    tenantId: string,
    itemId: string,
  ): Promise<{
    id: string;
    jobId: string;
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
    completedAt: Date | null;
    createdAt: Date;
  }> {
    const item = await this.prisma.jobItem.findFirst({
      where: { id: itemId, tenantId },
      select: {
        id: true,
        jobId: true,
        checkType: true,
        status: true,
        phoneE164: true,
        resultStatus: true,
        isReachable: true,
        imsi: true,
        mcc: true,
        mnc: true,
        operatorName: true,
        countryCode: true,
        ported: true,
        roaming: true,
        errorCode: true,
        errorMessage: true,
        completedAt: true,
        createdAt: true,
      },
    });
    if (!item) {
      throw new NotFoundException({
        errorCode: ErrorCodes.NOT_FOUND,
        message: `Check ${itemId} not found`,
      });
    }
    return item;
  }

  async create(dto: CreateJobDto): Promise<CreateJobResult & { progress: JobProgress }> {
    try {
      // Fail fast: tariff must exist and available balance must cover estimate.
      // Authoritative reserve still happens per item in the worker/lifecycle hooks.
      await this.billing.assertCanAfford({
        tenantId: dto.tenantId,
        checkType: dto.checkType,
        unitCount: dto.phones.length,
      });

      const result = await this.createJobService.create({
        tenantId: dto.tenantId,
        checkType: dto.checkType,
        source: dto.source,
        phones: dto.phones,
        idempotencyKey: dto.idempotencyKey,
        createdByUserId: dto.createdByUserId,
        apiKeyId: dto.apiKeyId,
        originalFilename: dto.originalFilename,
        requestId: dto.requestId,
      });
      return {
        ...result,
        progress: computeProgress(result.job),
      };
    } catch (error) {
      if (error instanceof JobsValidationError) {
        throw new BadRequestException({
          errorCode: ErrorCodes.VALIDATION_FAILED,
          message: error.message,
          details: error.details,
        });
      }
      throw error;
    }
  }

  /**
   * Apply provider callback/poll normalized result to a job item.
   * Idempotent — safe under duplicate deliveries.
   */
  async applyProviderUpdate(
    input: ApplyProviderUpdateInput,
  ): Promise<ApplyProviderUpdateResult> {
    try {
      return await this.lifecycleService.applyProviderUpdate(input);
    } catch (error) {
      if (error instanceof JobsNotFoundError) {
        throw new NotFoundException({
          errorCode: ErrorCodes.NOT_FOUND,
          message: error.message,
        });
      }
      throw error;
    }
  }

  /** Convenience for internal/callback wiring before dedicated E09 controller. */
  async applyNormalizedCallback(input: {
    jobItemId?: string;
    tenantId?: string;
    providerMessageId?: string | null;
    normalized: NormalizedResult;
  }): Promise<ApplyProviderUpdateResult> {
    return this.applyProviderUpdate({
      ...input,
      source: 'callback',
    });
  }
}

function mapJob(job: {
  id: string;
  tenantId: string;
  checkType: string;
  source: string;
  status: string;
  itemCount: number;
  successCount: number;
  failureCount: number;
  estimatedCost: { toString(): string } | string | null;
  actualCost: { toString(): string } | string | null;
  currency: string;
  createdAt: Date;
}): JobResponseDto {
  return {
    id: job.id,
    tenantId: job.tenantId,
    checkType: job.checkType,
    source: job.source,
    status: job.status,
    itemCount: job.itemCount,
    successCount: job.successCount,
    failureCount: job.failureCount,
    estimatedCost:
      job.estimatedCost === null || job.estimatedCost === undefined
        ? null
        : String(job.estimatedCost),
    actualCost:
      job.actualCost === null || job.actualCost === undefined
        ? null
        : String(job.actualCost),
    currency: job.currency,
    createdAt: job.createdAt,
  };
}
