import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@finenumbers/db';
import {
  assertCsvByteLimit,
  normalizeAndDeduplicatePhones,
  streamParsePhoneFile,
  JobsValidationError,
} from '@finenumbers/jobs';
import { unlink } from 'node:fs/promises';

import { ErrorCodes } from '../../common/errors/error-codes';
import { AppLogger } from '../../common/logger/app-logger.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NestBillingService } from '../billing/billing.service';
import { JobsService } from '../jobs/jobs.service';
import { resolveLimits } from '../settings/resolve-limits';
import { toCabinetJobView, toCabinetSellEstimate } from './cabinet-client-view';

const PREVIEW_TTL_MS = 60 * 60 * 1000;
const MAX_READY_PREVIEWS_PER_TENANT = 3;
const MAX_INVALID_SAMPLES = 50;
const DEFAULT_PHONE_PAGE = 100;
const MAX_PHONE_PAGE = 100;

@Injectable()
export class CsvPreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: NestBillingService,
    private readonly jobs: JobsService,
    private readonly logger: AppLogger,
  ) {}

  async createFromUpload(input: {
    tenantId: string;
    checkType: 'HLR' | 'PING';
    file: { path: string; originalname: string; size: number };
    createdByUserId: string;
  }) {
    const limits = await resolveLimits(this.prisma, { tenantId: input.tenantId });

    try {
      assertCsvByteLimit(input.file.size, limits.maxCsvBytes);
    } catch (error) {
      await safeUnlink(input.file.path);
      if (error instanceof JobsValidationError) {
        throw new PayloadTooLargeException({
          errorCode: ErrorCodes.PAYLOAD_TOO_LARGE,
          message: error.message,
          details: error.details,
        });
      }
      throw error;
    }

    // Tariff must exist; no afford / no Job / no SMSC.
    let previewQuote: { unitSellPrice: string; currency: string };
    try {
      const estimate = await this.billing.estimate({
        tenantId: input.tenantId,
        checkType: input.checkType,
        unitCount: 1,
      });
      previewQuote = {
        unitSellPrice: estimate.unitSellPrice,
        currency: estimate.currency,
      };
    } catch (error) {
      await safeUnlink(input.file.path);
      throw error;
    }

    try {
      const readyCount = await this.prisma.csvPreview.count({
        where: {
          tenantId: input.tenantId,
          status: 'READY',
          expiresAt: { gt: new Date() },
        },
      });
      if (readyCount >= MAX_READY_PREVIEWS_PER_TENANT) {
        await safeUnlink(input.file.path);
        throw new BadRequestException({
          errorCode: ErrorCodes.VALIDATION_FAILED,
          message: `Too many active CSV previews (max ${MAX_READY_PREVIEWS_PER_TENANT}). Submit or wait for expiry.`,
        });
      }

      let parsed;
      try {
        parsed = await streamParsePhoneFile(input.file.path, {
          maxRows: limits.maxCsvRows,
        });
      } finally {
        await safeUnlink(input.file.path);
      }

      if (parsed.truncated || parsed.rowCount > limits.maxCsvRows) {
        throw new BadRequestException({
          errorCode: ErrorCodes.VALIDATION_FAILED,
          message: `CSV exceeds maxCsvRows (${limits.maxCsvRows})`,
        });
      }

      const normalized = normalizeAndDeduplicatePhones(parsed.phones);
      const invalidSamples = normalized.invalid.slice(0, MAX_INVALID_SAMPLES).map((row) => ({
        input: row.input,
        reason: row.reason,
      }));
      const status =
        normalized.invalid.length > 0 || normalized.phones.length === 0 ? 'INVALID' : 'READY';

      const preview = await this.prisma.csvPreview.create({
        data: {
          tenantId: input.tenantId,
          createdByUserId: input.createdByUserId,
          checkType: input.checkType,
          status,
          originalFilename: input.file.originalname,
          rowCount: parsed.rowCount,
          validCount: normalized.phones.length,
          invalidCount: normalized.invalid.length,
          deduplicatedCount: normalized.deduplicatedCount,
          phonesJson: status === 'READY' ? normalized.phones : [],
          invalidJson: invalidSamples,
          previewUnitSellPrice: previewQuote.unitSellPrice,
          previewCurrency: previewQuote.currency,
          expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
        },
      });

      this.logger.log(
        {
          message: 'cabinet.csv_preview.created',
          previewId: preview.id,
          tenantId: preview.tenantId,
          status: preview.status,
          validCount: preview.validCount,
          invalidCount: preview.invalidCount,
        },
        'Cabinet',
      );

      return this.toPreviewView(preview, 1, DEFAULT_PHONE_PAGE);
    } catch (error) {
      await safeUnlink(input.file.path);
      this.rethrowPreviewStorageError(error, 'cabinet.csv_preview.create_failed');
    }
  }

  async getForTenant(tenantId: string, previewId: string) {
    const preview = await this.requirePreview(tenantId, previewId);
    return this.toPreviewView(preview, 1, DEFAULT_PHONE_PAGE);
  }

  async listPhones(
    tenantId: string,
    previewId: string,
    page: number,
    pageSize: number,
  ) {
    const preview = await this.requirePreview(tenantId, previewId);
    const size = Math.min(Math.max(pageSize, 1), MAX_PHONE_PAGE);
    const current = Math.max(page, 1);
    const phones = asStringArray(preview.phonesJson);
    const total = phones.length;
    const start = (current - 1) * size;
    return {
      items: phones.slice(start, start + size),
      page: current,
      pageSize: size,
      total,
    };
  }

  async estimate(tenantId: string, previewId: string) {
    const preview = await this.requirePreview(tenantId, previewId);
    if (preview.status !== 'READY') {
      throw new BadRequestException({
        errorCode: ErrorCodes.VALIDATION_FAILED,
        message: 'CSV preview is not ready to estimate',
      });
    }
    if (preview.validCount < 1) {
      throw new BadRequestException({
        errorCode: ErrorCodes.VALIDATION_FAILED,
        message: 'CSV preview has no valid phones',
      });
    }
    const estimate = await this.billing.estimate({
      tenantId,
      checkType: preview.checkType,
      unitCount: preview.validCount,
    });
    return toCabinetSellEstimate(estimate);
  }

  /**
   * Only entry that creates a Job and enqueues checks — called from Submit button.
   */
  async submit(input: {
    tenantId: string;
    previewId: string;
    createdByUserId: string;
    requestId?: string | null;
  }) {
    const now = new Date();
    const claimed = await this.prisma.csvPreview.updateMany({
      where: {
        id: input.previewId,
        tenantId: input.tenantId,
        status: 'READY',
        expiresAt: { gt: now },
      },
      data: { status: 'CONSUMING' },
    });
    if (claimed.count === 0) {
      const existing = await this.prisma.csvPreview.findFirst({
        where: { id: input.previewId, tenantId: input.tenantId },
      });
      if (!existing) {
        throw new NotFoundException({
          errorCode: ErrorCodes.NOT_FOUND,
          message: 'CSV preview not found',
        });
      }
      if (existing.status === 'CONSUMED' && existing.consumedJobId) {
        const job = await this.jobs.getByIdForTenant(
          input.tenantId,
          existing.consumedJobId,
        );
        return {
          job: toCabinetJobView(job),
          progress: job.progress,
        };
      }
      if (existing.expiresAt <= now || existing.status === 'EXPIRED') {
        throw new GoneException({
          errorCode: ErrorCodes.VALIDATION_FAILED,
          message: 'CSV preview expired — upload the file again',
        });
      }
      throw new ConflictException({
        errorCode: ErrorCodes.CONFLICT,
        message: `CSV preview is not submittable (status=${existing.status})`,
      });
    }

    const preview = await this.prisma.csvPreview.findFirstOrThrow({
      where: { id: input.previewId, tenantId: input.tenantId },
    });
    const phones = asStringArray(preview.phonesJson);
    if (phones.length === 0) {
      await this.prisma.csvPreview.update({
        where: { id: preview.id },
        data: { status: 'INVALID' },
      });
      throw new BadRequestException({
        errorCode: ErrorCodes.VALIDATION_FAILED,
        message: 'CSV preview has no valid phones',
      });
    }

    try {
      const result = await this.jobs.createFromPreviewPhones({
        tenantId: input.tenantId,
        checkType: preview.checkType,
        phones,
        originalFilename: preview.originalFilename,
        createdByUserId: input.createdByUserId,
        previewId: preview.id,
        requestId: input.requestId,
      });

      await this.prisma.csvPreview.update({
        where: { id: preview.id },
        data: {
          status: 'CONSUMED',
          consumedJobId: result.job.id,
          phonesJson: Prisma.DbNull,
        },
      });

      return {
        job: toCabinetJobView(result.job),
        progress: result.progress,
      };
    } catch (error) {
      await this.prisma.csvPreview.update({
        where: { id: preview.id },
        data: { status: 'READY' },
      });
      throw error;
    }
  }

  private async requirePreview(tenantId: string, previewId: string) {
    const preview = await this.prisma.csvPreview.findFirst({
      where: { id: previewId, tenantId },
    });
    if (!preview) {
      throw new NotFoundException({
        errorCode: ErrorCodes.NOT_FOUND,
        message: 'CSV preview not found',
      });
    }
    if (preview.expiresAt <= new Date() && preview.status === 'READY') {
      await this.prisma.csvPreview.update({
        where: { id: preview.id },
        data: { status: 'EXPIRED', phonesJson: Prisma.DbNull },
      });
      throw new GoneException({
        errorCode: ErrorCodes.VALIDATION_FAILED,
        message: 'CSV preview expired — upload the file again',
      });
    }
    return preview;
  }

  private toPreviewView(
    preview: {
      id: string;
      tenantId: string;
      checkType: 'HLR' | 'PING';
      status: string;
      originalFilename: string | null;
      rowCount: number;
      validCount: number;
      invalidCount: number;
      deduplicatedCount: number;
      phonesJson: unknown;
      invalidJson: unknown;
      previewUnitSellPrice: { toString(): string } | null;
      previewCurrency: string;
      expiresAt: Date;
      consumedJobId: string | null;
      createdAt: Date;
    },
    page: number,
    pageSize: number,
  ) {
    const phones = asStringArray(preview.phonesJson);
    const start = (page - 1) * pageSize;
    return {
      id: preview.id,
      checkType: preview.checkType,
      status: preview.status,
      originalFilename: preview.originalFilename,
      stats: {
        rowCount: preview.rowCount,
        validCount: preview.validCount,
        invalidCount: preview.invalidCount,
        deduplicatedCount: preview.deduplicatedCount,
      },
      unitSellPrice:
        preview.previewUnitSellPrice === null
          ? null
          : String(preview.previewUnitSellPrice),
      currency: preview.previewCurrency,
      expiresAt: preview.expiresAt.toISOString(),
      consumedJobId: preview.consumedJobId,
      createdAt: preview.createdAt.toISOString(),
      invalidSamples: Array.isArray(preview.invalidJson) ? preview.invalidJson : [],
      phones: {
        items: phones.slice(start, start + pageSize),
        page,
        pageSize,
        total: phones.length,
      },
    };
  }

  private rethrowPreviewStorageError(error: unknown, logMessage: string): never {
    if (
      error instanceof BadRequestException ||
      error instanceof ConflictException ||
      error instanceof GoneException ||
      error instanceof NotFoundException ||
      error instanceof PayloadTooLargeException ||
      error instanceof ServiceUnavailableException
    ) {
      throw error;
    }

    const code =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof (error as { code: unknown }).code === 'string'
        ? (error as { code: string }).code
        : '';
    const message = error instanceof Error ? error.message : String(error);
    const missingTable =
      code === 'P2021' ||
      /csv_previews/i.test(message) ||
      /does not exist/i.test(message);

    this.logger.error(
      {
        message: logMessage,
        prismaCode: code || undefined,
        error: message,
      },
      'Cabinet',
    );

    if (missingTable) {
      throw new ServiceUnavailableException({
        errorCode: ErrorCodes.SERVICE_UNAVAILABLE,
        message:
          'CSV preview storage is not ready. Apply database migrations (csv_previews) and retry.',
      });
    }

    throw error;
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // best-effort
  }
}
