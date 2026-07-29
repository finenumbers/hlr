import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import { chunkArray, normalizeAndDeduplicatePhones } from './phone.js';
import type { CreateJobServiceDeps, JobsLogger } from './ports.js';
import { DEFAULT_JOB_RUNTIME_SETTINGS } from './queue-names.js';
import type { CsvParsePayload, JobRecord, JobRuntimeSettings } from './types.js';
import { JobsNotFoundError, JobsValidationError } from './types.js';

const silentLogger: JobsLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function mergeSettings(
  base: JobRuntimeSettings,
  override?: Partial<JobRuntimeSettings>,
): JobRuntimeSettings {
  return { ...base, ...override };
}

/**
 * Stream-parse a CSV/TXT phone list (one phone per line, or first CSV column).
 * Skips empty lines and a header row when the first cell looks non-numeric.
 */
export async function streamParsePhoneFile(
  filePath: string,
  options: { maxRows: number },
): Promise<{ phones: string[]; rowCount: number; truncated: boolean }> {
  const phones: string[] = [];
  let rowCount = 0;
  let truncated = false;
  let isFirst = true;

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const firstCell = splitCsvFirstCell(trimmed);
    if (!firstCell) continue;

    if (isFirst) {
      isFirst = false;
      if (looksLikeHeader(firstCell)) {
        continue;
      }
    }

    rowCount += 1;
    if (rowCount > options.maxRows) {
      truncated = true;
      rl.close();
      break;
    }
    phones.push(firstCell);
  }

  return { phones, rowCount, truncated };
}

function splitCsvFirstCell(line: string): string {
  // Minimal CSV: handle quoted first field, otherwise split on comma/semicolon/tab.
  if (line.startsWith('"')) {
    const end = line.indexOf('"', 1);
    if (end > 1) {
      return line.slice(1, end).trim();
    }
  }
  const parts = line.split(/[,;\t]/);
  return (parts[0] ?? '').trim().replace(/^"|"$/g, '');
}

function looksLikeHeader(cell: string): boolean {
  const lower = cell.toLowerCase();
  if (lower === 'phone' || lower === 'msisdn' || lower === 'number' || lower === 'e164') {
    return true;
  }
  // Digits / +digits → data row
  return !/^\+?\d[\d\s()-]{5,}$/.test(cell);
}

export type CsvParseResult = {
  job: JobRecord;
  workUnits: number;
  batchesEnqueued: number;
  deduplicatedPhoneCount: number;
  failed: boolean;
};

/**
 * Worker-side: parse uploaded CSV → attach items → enqueue submit batches.
 */
export class CsvParseService {
  private readonly logger: JobsLogger;

  constructor(private readonly deps: CreateJobServiceDeps) {
    this.logger = deps.logger ?? silentLogger;
  }

  async process(payload: CsvParsePayload): Promise<CsvParseResult> {
    const job = await this.deps.store.findJobById(payload.jobId);
    if (!job || job.tenantId !== payload.tenantId) {
      throw new JobsNotFoundError(`Job ${payload.jobId} not found for CSV parse`);
    }

    if (job.itemCount > 0) {
      this.logger.info('jobs.csv_parse.already_attached', {
        jobId: job.id,
        itemCount: job.itemCount,
      });
      return {
        job,
        workUnits: job.itemCount,
        batchesEnqueued: 0,
        deduplicatedPhoneCount: 0,
        failed: false,
      };
    }

    const storedSettings = await this.deps.store.getRuntimeSettings(payload.tenantId);
    const settings = mergeSettings({
      ...DEFAULT_JOB_RUNTIME_SETTINGS,
      ...storedSettings,
    });

    await this.deps.store.markJobProcessing(job.id);

    let parsed;
    try {
      parsed = await streamParsePhoneFile(payload.filePath, {
        maxRows: settings.maxCsvRows,
      });
    } catch (error) {
      await this.deps.store.finalizeJob({
        jobId: job.id,
        status: 'FAILED',
        errorCode: 'CSV_READ_FAILED',
        errorMessage: error instanceof Error ? error.message : 'Failed to read CSV',
      });
      throw error;
    }

    if (parsed.truncated || parsed.rowCount > settings.maxCsvRows) {
      const failed = await this.deps.store.finalizeJob({
        jobId: job.id,
        status: 'FAILED',
        errorCode: 'CSV_TOO_MANY_ROWS',
        errorMessage: `CSV exceeds maxCsvRows (${settings.maxCsvRows})`,
      });
      return {
        job: failed ?? job,
        workUnits: 0,
        batchesEnqueued: 0,
        deduplicatedPhoneCount: 0,
        failed: true,
      };
    }

    if (parsed.phones.length === 0) {
      const failed = await this.deps.store.finalizeJob({
        jobId: job.id,
        status: 'FAILED',
        errorCode: 'CSV_EMPTY',
        errorMessage: 'CSV contained no phone numbers',
      });
      return {
        job: failed ?? job,
        workUnits: 0,
        batchesEnqueued: 0,
        deduplicatedPhoneCount: 0,
        failed: true,
      };
    }

    const normalized = normalizeAndDeduplicatePhones(parsed.phones);
    if (normalized.invalid.length > 0) {
      const failed = await this.deps.store.finalizeJob({
        jobId: job.id,
        status: 'FAILED',
        errorCode: 'CSV_INVALID_PHONES',
        errorMessage: `Invalid phones: ${normalized.invalid.length} (showing up to 5: ${normalized.invalid
          .slice(0, 5)
          .join(', ')})`,
      });
      return {
        job: failed ?? job,
        workUnits: 0,
        batchesEnqueued: 0,
        deduplicatedPhoneCount: normalized.deduplicatedCount,
        failed: true,
      };
    }

    if (normalized.phones.length === 0) {
      const failed = await this.deps.store.finalizeJob({
        jobId: job.id,
        status: 'FAILED',
        errorCode: 'CSV_EMPTY',
        errorMessage: 'No valid phones after normalization',
      });
      return {
        job: failed ?? job,
        workUnits: 0,
        batchesEnqueued: 0,
        deduplicatedPhoneCount: normalized.deduplicatedCount,
        failed: true,
      };
    }

    if (!job.unitSellPrice) {
      const failed = await this.deps.store.finalizeJob({
        jobId: job.id,
        status: 'FAILED',
        errorCode: 'PRICE_SNAPSHOT_MISSING',
        errorMessage: 'CSV job shell has no unitSellPrice snapshot',
      });
      return {
        job: failed ?? job,
        workUnits: 0,
        batchesEnqueued: 0,
        deduplicatedPhoneCount: normalized.deduplicatedCount,
        failed: true,
      };
    }

    if (!this.deps.assertCanAffordFrozen) {
      throw new Error(
        'CsvParseService requires assertCanAffordFrozen (frozen unit price × count)',
      );
    }

    try {
      await this.deps.assertCanAffordFrozen({
        tenantId: job.tenantId,
        checkType: job.checkType,
        unitCount: normalized.phones.length,
        unitSellPrice: job.unitSellPrice,
      });
    } catch (error) {
      const code =
        typeof error === 'object' &&
        error !== null &&
        (error as { name?: string }).name === 'BillingError' &&
        typeof (error as { code?: unknown }).code === 'string'
          ? (error as { code: string }).code
          : 'CSV_AFFORDABILITY_FAILED';
      const message = error instanceof Error ? error.message : 'Cannot afford CSV job';
      const failed = await this.deps.store.finalizeJob({
        jobId: job.id,
        status: 'FAILED',
        errorCode: code,
        errorMessage: message,
      });
      this.logger.warn('jobs.csv_parse.affordability_failed', {
        jobId: job.id,
        tenantId: job.tenantId,
        checkType: job.checkType,
        unitCount: normalized.phones.length,
        unitSellPrice: job.unitSellPrice,
        code,
      });
      return {
        job: failed ?? job,
        workUnits: 0,
        batchesEnqueued: 0,
        deduplicatedPhoneCount: normalized.deduplicatedCount,
        failed: true,
      };
    }

    const { job: updated, items } = await this.deps.store.attachItemsToJob({
      jobId: job.id,
      tenantId: job.tenantId,
      checkType: job.checkType,
      phones: normalized.phones,
      currency: job.currency,
    });

    const batches = chunkArray(
      items.map((item) => item.id),
      settings.submitBatchSize,
    );

    for (const itemIds of batches) {
      await this.deps.queue.enqueueSubmitBatch({
        jobId: updated.id,
        tenantId: updated.tenantId,
        itemIds,
        ...(payload.requestId ? { requestId: payload.requestId } : {}),
      });
    }

    this.logger.info('jobs.csv_parse.enqueued', {
      jobId: updated.id,
      tenantId: updated.tenantId,
      workUnits: items.length,
      batchesEnqueued: batches.length,
      deduplicatedPhoneCount: normalized.deduplicatedCount,
      ...(payload.requestId ? { requestId: payload.requestId } : {}),
    });

    return {
      job: updated,
      workUnits: items.length,
      batchesEnqueued: batches.length,
      deduplicatedPhoneCount: normalized.deduplicatedCount,
      failed: false,
    };
  }
}

/** Thrown when CSV limits fail before enqueue (API-side). */
export function assertCsvByteLimit(fileSize: number, maxCsvBytes: number): void {
  if (fileSize > maxCsvBytes) {
    throw new JobsValidationError('CSV file exceeds maxCsvBytes', {
      fileSize,
      maxCsvBytes,
    });
  }
}
