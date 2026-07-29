import { chunkArray, normalizeAndDeduplicatePhones } from './phone.js';
import type { CreateJobServiceDeps, JobsLogger } from './ports.js';
import { DEFAULT_JOB_RUNTIME_SETTINGS } from './queue-names.js';
import type { CreateJobInput, CreateJobResult, JobRuntimeSettings } from './types.js';
import { JobsValidationError } from './types.js';

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

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

/**
 * Application service: validate phones → persist Job/JobItems → enqueue submit batches.
 * Heavy work (provider I/O) is never done here.
 */
export class CreateJobService {
  private readonly logger: JobsLogger;

  constructor(private readonly deps: CreateJobServiceDeps) {
    this.logger = deps.logger ?? silentLogger;
  }

  async create(input: CreateJobInput): Promise<CreateJobResult> {
    if (!input.tenantId?.trim()) {
      throw new JobsValidationError('tenantId is required');
    }
    if (input.checkType !== 'HLR' && input.checkType !== 'PING') {
      throw new JobsValidationError('checkType must be HLR or PING', {
        checkType: input.checkType,
      });
    }
    if (input.source !== 'SINGLE' && input.source !== 'BULK' && input.source !== 'API') {
      throw new JobsValidationError('source must be SINGLE, BULK, or API', {
        source: input.source,
      });
    }
    if (!Array.isArray(input.phones) || input.phones.length === 0) {
      throw new JobsValidationError('phones must be a non-empty array');
    }

    if (input.idempotencyKey) {
      const existing = await this.deps.store.findJobByIdempotencyKey(
        input.tenantId,
        input.idempotencyKey,
      );
      if (existing) {
        this.logger.info('jobs.create.idempotent_hit', {
          tenantId: input.tenantId,
          jobId: existing.id,
          idempotencyKey: input.idempotencyKey,
        });
        return {
          job: existing,
          deduplicated: true,
          deduplicatedPhoneCount: 0,
          workUnits: existing.itemCount,
          batchesEnqueued: 0,
        };
      }
    }

    const storedSettings = await this.deps.store.getRuntimeSettings(input.tenantId);
    const settings = mergeSettings(
      { ...DEFAULT_JOB_RUNTIME_SETTINGS, ...storedSettings },
      input.runtimeSettings,
    );

    const normalized = normalizeAndDeduplicatePhones(input.phones);
    if (normalized.invalid.length > 0) {
      throw new JobsValidationError('One or more phone numbers are invalid', {
        invalid: normalized.invalid.slice(0, 20),
        invalidCount: normalized.invalid.length,
      });
    }
    if (normalized.phones.length === 0) {
      throw new JobsValidationError('No valid phone numbers after normalization');
    }
    if (normalized.phones.length > settings.maxBatchPhones) {
      throw new JobsValidationError('Phone count exceeds maxBatchPhones', {
        count: normalized.phones.length,
        maxBatchPhones: settings.maxBatchPhones,
      });
    }
    if (input.source === 'SINGLE' && normalized.phones.length !== 1) {
      throw new JobsValidationError('SINGLE source requires exactly one phone', {
        count: normalized.phones.length,
      });
    }
    if (
      !input.priceSnapshot?.unitSellPrice ||
      !input.priceSnapshot.unitProviderCost ||
      !input.priceSnapshot.tariffPlanId ||
      !input.priceSnapshot.tariffPlanCode
    ) {
      throw new JobsValidationError(
        'priceSnapshot is required (unitSellPrice, unitProviderCost, tariffPlanId, tariffPlanCode)',
      );
    }

    let job;
    let items;
    try {
      ({ job, items } = await this.deps.store.createJobWithItems({
        tenantId: input.tenantId,
        checkType: input.checkType,
        source: input.source,
        phones: normalized.phones,
        idempotencyKey: input.idempotencyKey ?? null,
        createdByUserId: input.createdByUserId ?? null,
        apiKeyId: input.apiKeyId ?? null,
        originalFilename: input.originalFilename ?? null,
        currency: input.priceSnapshot?.currency ?? input.currency ?? 'RUB',
        priceSnapshot: input.priceSnapshot ?? null,
        metadata: input.metadata ?? null,
      }));
    } catch (error) {
      if (input.idempotencyKey && isUniqueViolation(error)) {
        const existing = await this.deps.store.findJobByIdempotencyKey(
          input.tenantId,
          input.idempotencyKey,
        );
        if (existing) {
          return {
            job: existing,
            deduplicated: true,
            deduplicatedPhoneCount: 0,
            workUnits: existing.itemCount,
            batchesEnqueued: 0,
          };
        }
      }
      throw error;
    }

    const batches = chunkArray(
      items.map((item) => item.id),
      settings.submitBatchSize,
    );

    const requestId = input.requestId?.trim() || undefined;

    for (const itemIds of batches) {
      await this.deps.queue.enqueueSubmitBatch({
        jobId: job.id,
        tenantId: job.tenantId,
        itemIds,
        ...(requestId ? { requestId } : {}),
      });
    }

    this.logger.info('jobs.create.enqueued', {
      tenantId: job.tenantId,
      jobId: job.id,
      checkType: job.checkType,
      source: job.source,
      workUnits: items.length,
      batchesEnqueued: batches.length,
      deduplicatedPhoneCount: normalized.deduplicatedCount,
      ...(requestId ? { requestId } : {}),
    });

    return {
      job,
      deduplicated: false,
      deduplicatedPhoneCount: normalized.deduplicatedCount,
      workUnits: items.length,
      batchesEnqueued: batches.length,
    };
  }
}
