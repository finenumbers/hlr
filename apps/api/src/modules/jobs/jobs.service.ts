import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  assertCsvByteLimit,
  computeProgress,
  CreateJobService,
  JobLifecycleService,
  JobsNotFoundError,
  JobsValidationError,
  type ApplyProviderUpdateInput,
  type ApplyProviderUpdateResult,
  type CreateJobResult,
  type JobProgress,
  type JobRecord,
  type JobsStore,
} from '@finenumbers/jobs';
import { createJobsWebhookHooks } from '@finenumbers/webhooks';
import type { NormalizedResult } from '@finenumbers/provider-core';
import { mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { AppConfigService } from '../../common/config/app-config.service';
import type { PaginatedResult } from '../../common/dto/pagination-query.dto';
import { ErrorCodes } from '../../common/errors/error-codes';
import { AppLogger } from '../../common/logger/app-logger.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { jobPriceSnapshotFromEstimate } from '@finenumbers/billing';

import { NestBillingService } from '../billing/billing.service';
import { resolveLimits } from '../settings/resolve-limits';
import { PROVIDER_SMSC } from '../provider-smsc/provider-adapter.port';
import type { ProviderSmscService } from '../provider-smsc/provider-smsc.service';
import { NestWebhookDeliveryService } from '../webhooks/nest-webhook-delivery.service';
import type { CreateJobDto } from './dto/create-job.dto';
import type { JobResponseDto } from './dto/job-response.dto';
import {
  buildJobItemsXlsxBuffer,
  jobItemsXlsxFilename,
} from './job-items-xlsx';
import { JOBS_PROCESSOR, JobsProcessorPort } from './jobs-processor.port';
import { JOBS_STORE } from './jobs-store.port';

@Injectable()
export class JobsService {
  private readonly store: JobsStore;
  private readonly createJobService: CreateJobService;
  private readonly lifecycleService: JobLifecycleService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLogger,
    private readonly config: AppConfigService,
    private readonly billing: NestBillingService,
    private readonly webhookDelivery: NestWebhookDeliveryService,
    @Inject(JOBS_PROCESSOR) private readonly processor: JobsProcessorPort,
    @Inject(PROVIDER_SMSC) provider: ProviderSmscService,
    @Inject(JOBS_STORE) store: JobsStore,
  ) {
    this.store = store;
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
  }) {
    await this.getByIdForTenant(input.tenantId, input.jobId);
    const page = Math.max(1, Number(input.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(input.pageSize) || 20));
    const skip = (page - 1) * pageSize;
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
        take: pageSize,
        orderBy: { createdAt: 'asc' },
        select: jobItemListSelect,
      }),
      this.prisma.jobItem.count({ where }),
    ]);

    return {
      items: items.map(mapJobItemListRow),
      page,
      pageSize,
      total,
    };
  }

  async getItemForTenant(tenantId: string, itemId: string) {
    const item = await this.prisma.jobItem.findFirst({
      where: { id: itemId, tenantId },
      select: jobItemListSelect,
    });
    if (!item) {
      throw new NotFoundException({
        errorCode: ErrorCodes.NOT_FOUND,
        message: `Check ${itemId} not found`,
      });
    }
    return mapJobItemListRow(item);
  }

  /**
   * Export all job items as a styled XLSX workbook.
   * Chunked cursor reads — safe for large jobs (materialized into one buffer).
   */
  async exportItemsXlsxForTenant(input: {
    tenantId: string;
    jobId: string;
    locale: 'en' | 'ru';
  }) {
    const job = await this.getByIdForTenant(input.tenantId, input.jobId);
    const pageSize = 500;
    const items: ReturnType<typeof mapJobItemListRow>[] = [];
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.prisma.jobItem.findMany({
        where: { tenantId: input.tenantId, jobId: input.jobId },
        take: pageSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
        select: jobItemListSelect,
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        items.push(mapJobItemListRow(row));
      }
      cursor = rows[rows.length - 1]?.id;
      if (rows.length < pageSize) break;
    }

    const buffer = await buildJobItemsXlsxBuffer({
      checkType: job.checkType,
      locale: input.locale,
      items,
    });
    return {
      buffer,
      filename: jobItemsXlsxFilename(job.checkType, job.id),
      job,
    };
  }

  async create(dto: CreateJobDto): Promise<CreateJobResult & { progress: JobProgress }> {
    try {
      // Fail fast: tariff must exist and available balance must cover estimate.
      // Unit price is frozen onto the job; reserve re-checks assignment but not re-prices.
      const estimate = await this.billing.assertCanAfford({
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
        currency: estimate.currency,
        priceSnapshot: jobPriceSnapshotFromEstimate(estimate),
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
   * Accept a CSV upload: size-check → persist file → job shell → enqueue csv-parse.
   * HTTP handler does not parse rows synchronously.
   */
  async createFromCsvUpload(input: {
    tenantId: string;
    checkType: 'HLR' | 'PING';
    file: { path: string; originalname: string; size: number };
    idempotencyKey?: string | null;
    createdByUserId?: string | null;
    apiKeyId?: string | null;
    requestId?: string | null;
  }): Promise<{ job: JobRecord; progress: JobProgress }> {
    const limits = await resolveLimits(this.prisma, { tenantId: input.tenantId });

    try {
      assertCsvByteLimit(input.file.size, limits.maxCsvBytes);
    } catch (error) {
      if (error instanceof JobsValidationError) {
        throw new PayloadTooLargeException({
          errorCode: ErrorCodes.PAYLOAD_TOO_LARGE,
          message: error.message,
          details: error.details,
        });
      }
      throw error;
    }

    // Fail fast: product must have an assigned tariff (and at least 1 unit of funds).
    // Freeze unit price on the shell; items inherit it at CSV attach.
    const estimate = await this.billing.assertCanAfford({
      tenantId: input.tenantId,
      checkType: input.checkType,
      unitCount: 1,
    });

    if (input.idempotencyKey) {
      const existing = await this.store.findJobByIdempotencyKey(
        input.tenantId,
        input.idempotencyKey,
      );
      if (existing) {
        // Heal: empty CSV shell still pending parse — re-enqueue if file remains.
        if (
          existing.itemCount === 0 &&
          existing.metadata?.csvPending === true &&
          typeof existing.metadata.csvFilePath === 'string'
        ) {
          try {
            await this.processor.enqueueCsvParse(
              {
                jobId: existing.id,
                tenantId: existing.tenantId,
                filePath: existing.metadata.csvFilePath,
                ...(input.requestId ? { requestId: input.requestId } : {}),
              },
              { replaceExisting: true },
            );
          } catch {
            // Best-effort; client still gets the existing shell.
          }
        }
        return { job: existing, progress: computeProgress(existing) };
      }
    }

    const tenantDir = join(this.config.uploadDir, input.tenantId);
    await mkdir(tenantDir, { recursive: true });
    const storedName = `${randomUUID()}.csv`;
    const destPath = join(tenantDir, storedName);
    await rename(input.file.path, destPath);

    const job = await this.store.createJobShell({
      tenantId: input.tenantId,
      checkType: input.checkType,
      source: 'BULK',
      idempotencyKey: input.idempotencyKey ?? null,
      createdByUserId: input.createdByUserId ?? null,
      apiKeyId: input.apiKeyId ?? null,
      originalFilename: input.file.originalname,
      currency: estimate.currency,
      priceSnapshot: jobPriceSnapshotFromEstimate(estimate),
      metadata: {
        csvPending: true,
        csvFilePath: destPath,
        csvMaxRows: limits.maxCsvRows,
      },
    });

    await this.processor.enqueueCsvParse({
      jobId: job.id,
      tenantId: job.tenantId,
      filePath: destPath,
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });

    this.logger.log(
      {
        message: 'jobs.csv_upload.accepted',
        jobId: job.id,
        tenantId: job.tenantId,
        originalFilename: input.file.originalname,
        fileSize: input.file.size,
      },
      'Jobs',
    );

    return { job, progress: computeProgress(job) };
  }

  /**
   * Cabinet Submit after CSV preview — same CreateJobService path as paste/BULK.
   * On enqueue failure CreateJobService deletes the job (no junk history row).
   */
  async createFromPreviewPhones(input: {
    tenantId: string;
    checkType: 'HLR' | 'PING';
    phones: string[];
    originalFilename?: string | null;
    createdByUserId?: string | null;
    previewId: string;
    requestId?: string | null;
  }): Promise<{ job: JobRecord; progress: JobProgress }> {
    if (input.phones.length === 0) {
      throw new BadRequestException({
        errorCode: ErrorCodes.VALIDATION_FAILED,
        message: 'No phones to submit',
      });
    }

    const limits = await resolveLimits(this.prisma, { tenantId: input.tenantId });
    if (input.phones.length > limits.maxCsvRows) {
      throw new BadRequestException({
        errorCode: ErrorCodes.VALIDATION_FAILED,
        message: `Phone count exceeds maxCsvRows (${limits.maxCsvRows})`,
      });
    }

    try {
      const estimate = await this.billing.assertCanAfford({
        tenantId: input.tenantId,
        checkType: input.checkType,
        unitCount: input.phones.length,
      });

      const result = await this.createJobService.create({
        tenantId: input.tenantId,
        checkType: input.checkType,
        source: 'BULK',
        phones: input.phones,
        createdByUserId: input.createdByUserId ?? null,
        originalFilename: input.originalFilename ?? null,
        requestId: input.requestId,
        currency: estimate.currency,
        priceSnapshot: jobPriceSnapshotFromEstimate(estimate),
        metadata: { fromPreviewId: input.previewId },
        // Preview already validated against maxCsvRows (not paste maxBatchPhones).
        runtimeSettings: { maxBatchPhones: limits.maxCsvRows },
      });

      this.logger.log(
        {
          message: 'jobs.csv_preview.submitted',
          jobId: result.job.id,
          tenantId: result.job.tenantId,
          previewId: input.previewId,
          phoneCount: input.phones.length,
          batchesEnqueued: result.batchesEnqueued,
        },
        'Jobs',
      );

      return { job: result.job, progress: computeProgress(result.job) };
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

  /** Best-effort rollback when post-create steps fail (e.g. mark preview CONSUMED). */
  async deleteJobCascade(jobId: string): Promise<void> {
    await this.store.deleteJobCascade(jobId);
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
  errorCode?: string | null;
  errorMessage?: string | null;
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
    errorCode: job.errorCode ?? null,
    errorMessage: job.errorMessage ?? null,
    createdAt: job.createdAt,
  };
}

const jobItemListSelect = {
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
  normalizedResult: true,
} as const;

function extrasString(
  extras: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = extras?.[key];
  if (value == null || value === '') return null;
  return String(value);
}

/** Lift reliable SMSC HLR extras from normalizedResult for list/detail UIs. */
function mapJobItemListRow(item: {
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
  normalizedResult: unknown;
}) {
  const extras =
    item.normalizedResult &&
    typeof item.normalizedResult === 'object' &&
    item.normalizedResult !== null &&
    'extras' in item.normalizedResult &&
    typeof (item.normalizedResult as { extras?: unknown }).extras === 'object' &&
    (item.normalizedResult as { extras?: unknown }).extras !== null
      ? ((item.normalizedResult as { extras: Record<string, unknown> }).extras)
      : undefined;

  const { normalizedResult: _normalized, ...rest } = item;
  return {
    ...rest,
    msc: extrasString(extras, 'msc'),
    region: extrasString(extras, 'region'),
    roamingCountry: extrasString(extras, 'roamingCountry'),
    roamingOperator: extrasString(extras, 'roamingOperator'),
  };
}
