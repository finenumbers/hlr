import { access } from 'node:fs/promises';

import type { NormalizedResult } from '@finenumbers/provider-core';
import { isProviderError } from '@finenumbers/provider-core';

import { createNoopBillingHooks, createNoopWebhookHooks } from './hooks.js';
import { chunkArray } from './phone.js';
import type {
  JobLifecycleServiceDeps,
  JobsBillingHooks,
  JobsLogger,
  JobsWebhookHooks,
} from './ports.js';
import { DEFAULT_JOB_RUNTIME_SETTINGS } from './queue-names.js';
import {
  computeProgress,
  deriveJobTerminalStatus,
  isTerminalJobItemStatus,
  isTerminalJobStatus,
  mapProviderLifecycleToItemStatus,
} from './state-machine.js';
import type {
  ApplyProviderUpdateInput,
  ApplyProviderUpdateResult,
  FinalizeJobPayload,
  JobItemRecord,
  JobRecord,
  PollItemPayload,
  ReconcileStalePayload,
  SubmitBatchPayload,
} from './types.js';
import { JobsNotFoundError } from './types.js';

const silentLogger: JobsLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** Prefer stable billing codes (e.g. TARIFF_NOT_CONFIGURED) over generic SUBMIT_FAILED. */
function billingFailureCode(error: unknown): string | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'BillingError' &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }
  return null;
}

/** Attach optional requestId for cross-process log correlation. */
function withRequestId<T extends object>(
  base: T,
  requestId?: string,
): T & { requestId?: string } {
  return requestId ? { ...base, requestId } : base;
}

function normalizedToPatch(normalized: NormalizedResult): {
  normalizedResult: Record<string, unknown>;
  resultStatus: string | null;
  isReachable: boolean | null;
  imsi: string | null;
  mcc: string | null;
  mnc: string | null;
  operatorName: string | null;
  countryCode: string | null;
  ported: boolean | null;
  roaming: boolean | null;
  actualCost: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  providerMessageId: string | null;
} {
  return {
    normalizedResult: { ...normalized } as unknown as Record<string, unknown>,
    resultStatus: normalized.resultStatus,
    isReachable: normalized.isReachable,
    imsi: normalized.imsi,
    mcc: normalized.mcc,
    mnc: normalized.mnc,
    operatorName: normalized.operatorName,
    countryCode: normalized.countryCode,
    ported: normalized.ported,
    roaming: normalized.roaming,
    actualCost: normalized.cost,
    errorCode: normalized.providerErrorCode,
    errorMessage: normalized.providerErrorMessage,
    providerMessageId: normalized.providerMessageId,
  };
}

function preferString(
  incoming: string | null | undefined,
  existing: string | null | undefined,
): string | null {
  if (incoming != null && incoming !== '') return incoming;
  if (existing != null && existing !== '') return existing;
  return incoming ?? existing ?? null;
}

function preferBool(
  incoming: boolean | null | undefined,
  existing: boolean | null | undefined,
): boolean | null {
  if (incoming != null) return incoming;
  return existing ?? null;
}

function extrasFromNormalizedResult(
  normalizedResult: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!normalizedResult || typeof normalizedResult !== 'object') return {};
  const extras = normalizedResult.extras;
  if (!extras || typeof extras !== 'object') return {};
  return { ...(extras as Record<string, unknown>) };
}

function mergeExtras(
  incoming: Record<string, unknown> | undefined,
  existing: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(existing ?? {}) };
  for (const [key, value] of Object.entries(incoming ?? {})) {
    if (value != null && value !== '') {
      out[key] = value;
    }
  }
  return out;
}

/** Merge incoming normalized HLR fields with already-stored item values (nulls do not clear). */
function mergeNormalizedWithItem(
  normalized: NormalizedResult,
  item: JobItemRecord,
): NormalizedResult {
  const existingExtras = extrasFromNormalizedResult(item.normalizedResult);
  return {
    ...normalized,
    providerMessageId: preferString(normalized.providerMessageId, item.providerMessageId),
    phoneE164: preferString(normalized.phoneE164, item.phoneE164),
    imsi: preferString(normalized.imsi, item.imsi),
    mcc: preferString(normalized.mcc, item.mcc),
    mnc: preferString(normalized.mnc, item.mnc),
    operatorName: preferString(normalized.operatorName, item.operatorName),
    countryCode: preferString(normalized.countryCode, item.countryCode),
    ported: preferBool(normalized.ported, item.ported),
    roaming: preferBool(normalized.roaming, item.roaming),
    isReachable: preferBool(normalized.isReachable, item.isReachable),
    resultStatus: preferString(normalized.resultStatus, item.resultStatus) as NormalizedResult['resultStatus'],
    extras: mergeExtras(normalized.extras, existingExtras),
  };
}

function needsHlrEnrich(normalized: NormalizedResult, checkType: string): boolean {
  if (checkType !== 'HLR' && normalized.checkType !== 'HLR') return false;
  const msc = normalized.extras?.msc;
  return !normalized.imsi || msc == null || msc === '';
}

function hlrFieldsImproved(normalized: NormalizedResult, item: JobItemRecord): boolean {
  const existingExtras = extrasFromNormalizedResult(item.normalizedResult);
  if (normalized.imsi && !item.imsi) return true;
  if (normalized.mcc && !item.mcc) return true;
  if (normalized.mnc && !item.mnc) return true;
  if (normalized.operatorName && !item.operatorName) return true;
  if (normalized.countryCode && !item.countryCode) return true;
  if (normalized.roaming != null && item.roaming == null) return true;
  if (
    normalized.isReachable != null &&
    normalized.isReachable !== item.isReachable
  ) {
    return true;
  }
  if (
    normalized.resultStatus &&
    normalized.resultStatus !== 'pending' &&
    normalized.resultStatus !== item.resultStatus
  ) {
    return true;
  }
  if (
    normalized.providerErrorCode != null &&
    normalized.providerErrorCode !== '' &&
    normalized.providerErrorCode !== item.errorCode
  ) {
    return true;
  }
  for (const key of ['msc', 'region', 'roamingCountry', 'roamingOperator']) {
    const next = normalized.extras?.[key];
    const prev = existingExtras[key];
    if (next != null && next !== '' && (prev == null || prev === '')) return true;
  }
  return false;
}

/**
 * Core lifecycle orchestrator: submit batches, poll/callback updates, finalize, reconcile.
 * Provider calls go only through JobsProviderPort (adapter).
 */
export class JobLifecycleService {
  private readonly logger: JobsLogger;
  private readonly billing: JobsBillingHooks;
  private readonly webhooks: JobsWebhookHooks;
  private readonly now: () => Date;

  constructor(private readonly deps: JobLifecycleServiceDeps) {
    this.logger = deps.logger ?? silentLogger;
    this.billing = deps.billing ?? createNoopBillingHooks(this.logger);
    this.webhooks = deps.webhooks ?? createNoopWebhookHooks(this.logger);
    this.now = deps.now ?? (() => new Date());
  }

  /** Process a submit-batch queue message. Partial item failures do not fail the batch. */
  async processSubmitBatch(payload: SubmitBatchPayload): Promise<{
    submitted: number;
    failed: number;
    skipped: number;
  }> {
    await this.deps.store.markJobProcessing(payload.jobId);

    let submitted = 0;
    let failed = 0;
    let skipped = 0;
    let anyTerminal = false;

    for (const itemId of payload.itemIds) {
      const claimed = await this.deps.store.claimItemForSubmit(itemId);
      if (!claimed) {
        skipped += 1;
        continue;
      }
      if (claimed.tenantId !== payload.tenantId || claimed.jobId !== payload.jobId) {
        this.logger.warn('jobs.submit.tenant_mismatch', {
          itemId,
          expectedTenantId: payload.tenantId,
          actualTenantId: claimed.tenantId,
        });
        skipped += 1;
        continue;
      }

      try {
        await this.billing.onItemReserved({
          tenantId: claimed.tenantId,
          jobItemId: claimed.id,
          checkType: claimed.checkType,
        });

        const submitInput = {
          phoneE164: claimed.phoneE164,
          idempotencyKey: claimed.id,
          tenantId: claimed.tenantId,
          jobItemId: claimed.id,
          correlationId: claimed.id,
        };
        const result =
          claimed.checkType === 'HLR'
            ? await this.deps.provider.submitHlr(submitInput)
            : await this.deps.provider.submitPing(submitInput);

        const nextStatus =
          mapProviderLifecycleToItemStatus(
            result.normalized.lifecycleStatus,
            'SENT',
          ) ?? 'PENDING';

        const patch = normalizedToPatch(result.normalized);
        const updated = await this.deps.store.updateItemAfterSubmit({
          jobItemId: claimed.id,
          status: nextStatus === 'COMPLETED' || nextStatus === 'FAILED' ? nextStatus : 'PENDING',
          providerCode: result.providerCode,
          ...patch,
          providerMessageId: result.providerMessageId ?? patch.providerMessageId,
          sentAt: this.now(),
          completedAt:
            nextStatus === 'COMPLETED' || nextStatus === 'FAILED' ? this.now() : null,
        });

        if (!updated) {
          skipped += 1;
          continue;
        }

        if (isTerminalJobItemStatus(updated.status)) {
          anyTerminal = true;
          failed += updated.status === 'FAILED' ? 1 : 0;
          submitted += updated.status === 'COMPLETED' ? 1 : 0;
          await this.onItemBecameTerminal(updated);
        } else {
          submitted += 1;
          await this.deps.queue.enqueuePollItem(
            withRequestId(
              { jobItemId: updated.id, tenantId: updated.tenantId, attempt: 1 },
              payload.requestId,
            ),
            await this.pollDelayMs(updated.tenantId),
          );
        }
      } catch (error) {
        const retryable = isProviderError(error) && error.retryable;
        if (retryable) {
          // Keep RESERVED; claimItemForSubmit re-accepts RESERVED on BullMQ retry.
          throw error;
        }

        const message = error instanceof Error ? error.message : 'Submit failed';
        const code = isProviderError(error)
          ? String(error.providerErrorCode ?? error.kind)
          : billingFailureCode(error) ?? 'SUBMIT_FAILED';

        const failedItem = await this.deps.store.updateItemAfterSubmit({
          jobItemId: claimed.id,
          status: 'FAILED',
          providerMessageId: null,
          providerCode: claimed.providerCode,
          errorCode: code,
          errorMessage: message,
          completedAt: this.now(),
        });
        failed += 1;
        anyTerminal = true;
        if (failedItem) {
          await this.onItemBecameTerminal(failedItem, 'release');
        }
        this.logger.warn('jobs.submit.item_failed', {
          jobId: payload.jobId,
          jobItemId: claimed.id,
          code,
          message,
          ...(payload.requestId ? { requestId: payload.requestId } : {}),
        });
      }
    }

    await this.deps.store.refreshJobCounters(payload.jobId);
    if (anyTerminal) {
      await this.deps.queue.enqueueFinalizeJob(
        withRequestId(
          {
            jobId: payload.jobId,
            tenantId: payload.tenantId,
            reason: 'submit-batch-progress',
          },
          payload.requestId,
        ),
      );
    }

    this.logger.info('jobs.submit.batch_done', {
      jobId: payload.jobId,
      tenantId: payload.tenantId,
      submitted,
      failed,
      skipped,
      ...(payload.requestId ? { requestId: payload.requestId } : {}),
    });

    return { submitted, failed, skipped };
  }

  async processPollItem(payload: PollItemPayload): Promise<{
    status: JobItemRecord['status'] | 'missing';
    rescheduled: boolean;
  }> {
    const item = await this.deps.store.findItemById(payload.jobItemId);
    if (!item || item.tenantId !== payload.tenantId) {
      return { status: 'missing', rescheduled: false };
    }
    if (isTerminalJobItemStatus(item.status)) {
      await this.deps.queue.enqueueFinalizeJob(
        withRequestId(
          {
            jobId: item.jobId,
            tenantId: item.tenantId,
            reason: 'poll-already-terminal',
          },
          payload.requestId,
        ),
      );
      return { status: item.status, rescheduled: false };
    }
    if (!item.providerMessageId) {
      const failed = await this.deps.store.transitionItem({
        jobItemId: item.id,
        fromStatuses: ['RESERVED', 'SENT', 'PENDING'],
        toStatus: 'FAILED',
        patch: {
          errorCode: 'MISSING_PROVIDER_MESSAGE_ID',
          errorMessage: 'Cannot poll without providerMessageId',
          completedAt: this.now(),
        },
      });
      if (failed) {
        await this.onItemBecameTerminal(failed, 'release');
      }
      await this.deps.queue.enqueueFinalizeJob(
        withRequestId(
          {
            jobId: item.jobId,
            tenantId: item.tenantId,
            reason: 'poll-missing-provider-id',
          },
          payload.requestId,
        ),
      );
      return { status: 'FAILED', rescheduled: false };
    }

    const settings = await this.deps.store.getRuntimeSettings(item.tenantId);
    const timeoutMs = settings.checkTimeoutSec * 1000;
    const ageMs = this.now().getTime() - (item.sentAt ?? item.createdAt).getTime();
    if (ageMs >= timeoutMs || payload.attempt > settings.pollMaxAttempts) {
      const failed = await this.deps.store.transitionItem({
        jobItemId: item.id,
        fromStatuses: ['SENT', 'PENDING', 'RESERVED'],
        toStatus: 'FAILED',
        patch: {
          errorCode: 'CHECK_TIMEOUT',
          errorMessage: 'Timed out waiting for provider final status',
          completedAt: this.now(),
        },
      });
      if (failed) {
        await this.onItemBecameTerminal(failed, 'release');
      }
      await this.deps.queue.enqueueFinalizeJob(
        withRequestId(
          {
            jobId: item.jobId,
            tenantId: item.tenantId,
            reason: 'poll-timeout',
          },
          payload.requestId,
        ),
      );
      this.logger.warn('jobs.poll.timeout', {
        jobItemId: item.id,
        jobId: item.jobId,
        attempt: payload.attempt,
        ageMs,
        ...(payload.requestId ? { requestId: payload.requestId } : {}),
      });
      return { status: 'FAILED', rescheduled: false };
    }

    try {
      const statusResult = await this.deps.provider.fetchStatus({
        providerMessageId: item.providerMessageId,
        phoneE164: item.phoneE164,
        checkType: item.checkType,
        tenantId: item.tenantId,
        jobItemId: item.id,
        includeDetails: true,
        correlationId: item.id,
      });

      const applied = await this.applyProviderUpdate({
        jobItemId: item.id,
        tenantId: item.tenantId,
        providerMessageId: item.providerMessageId,
        normalized: statusResult.normalized,
        source: 'poll',
      });

      if (applied.becameTerminal) {
        return { status: applied.jobItem?.status ?? 'COMPLETED', rescheduled: false };
      }

      const delay = this.backoffDelayMs(settings.pollIntervalSec, payload.attempt);
      await this.deps.queue.enqueuePollItem(
        withRequestId(
          {
            jobItemId: item.id,
            tenantId: item.tenantId,
            attempt: payload.attempt + 1,
          },
          payload.requestId,
        ),
        delay,
      );
      return { status: applied.jobItem?.status ?? item.status, rescheduled: true };
    } catch (error) {
      const retryable = !isProviderError(error) || error.retryable;
      if (retryable && payload.attempt < settings.pollMaxAttempts) {
        const delay = this.backoffDelayMs(settings.pollIntervalSec, payload.attempt);
        await this.deps.queue.enqueuePollItem(
          withRequestId(
            {
              jobItemId: item.id,
              tenantId: item.tenantId,
              attempt: payload.attempt + 1,
            },
            payload.requestId,
          ),
          delay,
        );
        this.logger.warn('jobs.poll.retry', {
          jobItemId: item.id,
          jobId: item.jobId,
          attempt: payload.attempt,
          message: error instanceof Error ? error.message : 'poll error',
          ...(payload.requestId ? { requestId: payload.requestId } : {}),
        });
        return { status: item.status, rescheduled: true };
      }

      const failed = await this.deps.store.transitionItem({
        jobItemId: item.id,
        fromStatuses: ['SENT', 'PENDING', 'RESERVED'],
        toStatus: 'FAILED',
        patch: {
          errorCode: isProviderError(error)
            ? String(error.providerErrorCode ?? error.kind)
            : 'POLL_FAILED',
          errorMessage: error instanceof Error ? error.message : 'Poll failed',
          completedAt: this.now(),
        },
      });
      if (failed) {
        await this.onItemBecameTerminal(failed, 'release');
      }
      await this.deps.queue.enqueueFinalizeJob(
        withRequestId(
          {
            jobId: item.jobId,
            tenantId: item.tenantId,
            reason: 'poll-failed',
          },
          payload.requestId,
        ),
      );
      this.logger.warn('jobs.poll.failed', {
        jobItemId: item.id,
        jobId: item.jobId,
        attempt: payload.attempt,
        message: error instanceof Error ? error.message : 'Poll failed',
        ...(payload.requestId ? { requestId: payload.requestId } : {}),
      });
      return { status: 'FAILED', rescheduled: false };
    }
  }

  /**
   * Idempotent status application from callback or poll.
   * Safe under duplicate delivery. HLR: enrich sparse terminals via status.php?all=2
   * and never clear already-stored network fields with nulls.
   */
  async applyProviderUpdate(
    input: ApplyProviderUpdateInput,
  ): Promise<ApplyProviderUpdateResult> {
    let item: JobItemRecord | null = null;
    if (input.jobItemId) {
      item = await this.deps.store.findItemById(input.jobItemId);
    } else if (input.providerMessageId) {
      item = await this.deps.store.findItemByProviderMessageId({
        providerCode: input.providerCode ?? input.normalized.providerCode,
        providerMessageId: input.providerMessageId,
        tenantId: input.tenantId,
      });
    }

    if (!item) {
      throw new JobsNotFoundError('JobItem not found for provider update');
    }
    if (input.tenantId && item.tenantId !== input.tenantId) {
      throw new JobsNotFoundError('JobItem not found for tenant');
    }

    if (isTerminalJobItemStatus(item.status)) {
      if (item.status === 'COMPLETED' && item.checkType === 'HLR') {
        const enriched = await this.enrichHlrIfNeeded(item, input.normalized);
        if (hlrFieldsImproved(enriched, item)) {
          const patched = await this.deps.store.transitionItem({
            jobItemId: item.id,
            fromStatuses: ['COMPLETED'],
            toStatus: 'COMPLETED',
            patch: {
              ...normalizedToPatch(enriched),
              providerMessageId:
                enriched.providerMessageId ?? item.providerMessageId,
              completedAt: item.completedAt,
            },
          });
          this.logger.info('jobs.update.hlr_enriched', {
            jobItemId: item.id,
            source: input.source,
          });
          return {
            applied: Boolean(patched),
            duplicate: false,
            jobItem: patched ?? item,
            becameTerminal: false,
          };
        }
      }
      this.logger.info('jobs.update.duplicate_terminal', {
        jobItemId: item.id,
        status: item.status,
        source: input.source,
      });
      return {
        applied: false,
        duplicate: true,
        jobItem: item,
        becameTerminal: false,
      };
    }

    let normalized = mergeNormalizedWithItem(input.normalized, item);

    const next = mapProviderLifecycleToItemStatus(
      normalized.lifecycleStatus,
      item.status,
    );
    if (!next) {
      return {
        applied: false,
        duplicate: false,
        jobItem: item,
        becameTerminal: false,
      };
    }

    if (next === 'COMPLETED' || next === 'FAILED') {
      normalized = await this.enrichHlrIfNeeded(item, normalized);
    }

    if (next === 'PENDING' && item.status === 'PENDING') {
      const patched = await this.deps.store.transitionItem({
        jobItemId: item.id,
        fromStatuses: ['PENDING', 'SENT'],
        toStatus: 'PENDING',
        patch: {
          ...normalizedToPatch(normalized),
          providerMessageId: normalized.providerMessageId ?? item.providerMessageId,
        },
      });
      return {
        applied: Boolean(patched),
        duplicate: false,
        jobItem: patched ?? item,
        becameTerminal: false,
      };
    }

    if (next === 'PENDING' && (item.status === 'SENT' || item.status === 'RESERVED')) {
      const patched = await this.deps.store.transitionItem({
        jobItemId: item.id,
        fromStatuses: ['SENT', 'RESERVED'],
        toStatus: 'PENDING',
        patch: {
          ...normalizedToPatch(normalized),
          providerMessageId: normalized.providerMessageId ?? item.providerMessageId,
          sentAt: item.sentAt ?? this.now(),
        },
      });
      return {
        applied: Boolean(patched),
        duplicate: false,
        jobItem: patched ?? item,
        becameTerminal: false,
      };
    }

    if (next !== 'COMPLETED' && next !== 'FAILED') {
      return {
        applied: false,
        duplicate: false,
        jobItem: item,
        becameTerminal: false,
      };
    }

    const patched = await this.deps.store.transitionItem({
      jobItemId: item.id,
      fromStatuses: ['QUEUED', 'RESERVED', 'SENT', 'PENDING'],
      toStatus: next,
      patch: {
        ...normalizedToPatch(normalized),
        providerMessageId: normalized.providerMessageId ?? item.providerMessageId,
        completedAt: this.now(),
      },
    });

    if (!patched) {
      const fresh = await this.deps.store.findItemById(item.id);
      return {
        applied: false,
        duplicate: Boolean(fresh && isTerminalJobItemStatus(fresh.status)),
        jobItem: fresh,
        becameTerminal: false,
      };
    }

    // Policy B: capture on provider final status (including provider err / unreachable).
    // release is used only for send-fail / timeout (submit & poll timeout paths).
    await this.onItemBecameTerminal(patched, 'capture');

    await this.deps.queue.enqueueFinalizeJob({
      jobId: patched.jobId,
      tenantId: patched.tenantId,
      reason: `provider-${input.source}`,
    });

    this.logger.info('jobs.update.applied', {
      jobId: patched.jobId,
      jobItemId: patched.id,
      tenantId: patched.tenantId,
      status: patched.status,
      source: input.source,
    });

    return {
      applied: true,
      duplicate: false,
      jobItem: patched,
      becameTerminal: true,
    };
  }

  /**
   * When SMSC callback/poll is terminal but missing IMSI/MSC, fetch status.php?all=2
   * and merge only real non-empty HLR fields (never invent values).
   */
  private async enrichHlrIfNeeded(
    item: JobItemRecord,
    normalized: NormalizedResult,
  ): Promise<NormalizedResult> {
    const merged = mergeNormalizedWithItem(normalized, item);
    if (!needsHlrEnrich(merged, item.checkType)) {
      return merged;
    }
    const providerMessageId = merged.providerMessageId ?? item.providerMessageId;
    if (!providerMessageId) {
      return merged;
    }

    try {
      const statusResult = await this.deps.provider.fetchStatus({
        checkType: 'HLR',
        phoneE164: item.phoneE164,
        providerMessageId,
        tenantId: item.tenantId,
        jobItemId: item.id,
        includeDetails: true,
      });
      const rich = statusResult.normalized;
      return {
        ...merged,
        // Network fields + reachability/err: status.php?all=2 wins when defined.
        imsi: preferString(rich.imsi, merged.imsi),
        mcc: preferString(rich.mcc, merged.mcc),
        mnc: preferString(rich.mnc, merged.mnc),
        operatorName: preferString(rich.operatorName, merged.operatorName),
        countryCode: preferString(rich.countryCode, merged.countryCode),
        roaming: preferBool(rich.roaming, merged.roaming),
        ported: preferBool(rich.ported, merged.ported),
        isReachable: preferBool(rich.isReachable, merged.isReachable),
        resultStatus: preferString(
          rich.resultStatus,
          merged.resultStatus,
        ) as NormalizedResult['resultStatus'],
        providerErrorCode: preferString(
          rich.providerErrorCode,
          merged.providerErrorCode,
        ),
        providerErrorMessage: preferString(
          rich.providerErrorMessage,
          merged.providerErrorMessage,
        ),
        providerStatusCode: preferString(
          rich.providerStatusCode,
          merged.providerStatusCode,
        ),
        extras: mergeExtras(rich.extras, merged.extras),
        cost: preferString(merged.cost, rich.cost),
      };
    } catch (err) {
      this.logger.warn('jobs.hlr.enrich_failed', {
        jobItemId: item.id,
        providerMessageId,
        error: err instanceof Error ? err.message : String(err),
      });
      return merged;
    }
  }

  async processFinalizeJob(payload: FinalizeJobPayload): Promise<JobRecord | null> {
    let job = await this.deps.store.refreshJobCounters(payload.jobId);
    if (job.tenantId !== payload.tenantId) {
      throw new JobsNotFoundError(`Job ${payload.jobId} not found for tenant`);
    }
    if (isTerminalJobStatus(job.status)) {
      // Idempotent settle/reconcile if a prior finalize committed status but billing failed.
      await this.safeBillingOnJobFinalized(job);
      return job;
    }

    let progress = computeProgress(job);
    if (progress.pending > 0) {
      // Last item may have completed while this finalize was already running.
      job = await this.deps.store.refreshJobCounters(payload.jobId);
      progress = computeProgress(job);
      if (progress.pending > 0) {
        this.logger.debug('jobs.finalize.waiting', {
          jobId: job.id,
          ...progress,
          reason: payload.reason,
        });
        return job;
      }
    }

    const terminal = deriveJobTerminalStatus({
      total: progress.total,
      success: progress.success,
      failed: progress.failed,
    });

    const finalized = await this.deps.store.finalizeJob({
      jobId: job.id,
      status: terminal,
    });
    if (!finalized) {
      return this.deps.store.findJobById(job.id);
    }

    await this.safeBillingOnJobFinalized(finalized);
    try {
      await this.webhooks.onJobFinalized({
        tenantId: finalized.tenantId,
        jobId: finalized.id,
        status: finalized.status,
      });
    } catch (err) {
      this.logger.error('jobs.finalize.webhooks_failed', {
        jobId: finalized.id,
        tenantId: finalized.tenantId,
        reason: payload.reason,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    this.logger.info('jobs.finalize.done', {
      jobId: finalized.id,
      tenantId: finalized.tenantId,
      status: finalized.status,
      ...computeProgress(finalized),
      reason: payload.reason,
      ...(payload.requestId ? { requestId: payload.requestId } : {}),
    });

    return finalized;
  }

  private async safeBillingOnJobFinalized(job: JobRecord): Promise<void> {
    try {
      await this.billing.onJobFinalized({
        tenantId: job.tenantId,
        jobId: job.id,
        status: job.status,
      });
    } catch (err) {
      this.logger.error('jobs.finalize.billing_failed', {
        jobId: job.id,
        tenantId: job.tenantId,
        status: job.status,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async processReconciliation(
    payload: ReconcileStalePayload = {},
  ): Promise<{ polled: number; finalized: number }> {
    const limit = payload.limit ?? 100;
    const settings = DEFAULT_JOB_RUNTIME_SETTINGS;
    const olderThan = new Date(
      this.now().getTime() - settings.pollIntervalSec * 1000,
    );

    const stale = await this.deps.store.listStalePendingItems({ olderThan, limit });
    for (const item of stale) {
      await this.deps.queue.enqueuePollItem({
        jobItemId: item.id,
        tenantId: item.tenantId,
        attempt: 1,
      });
    }

    const needing = await this.deps.store.listJobsNeedingFinalize({ limit });
    let finalizedCount = 0;
    for (const job of needing) {
      // Finalize inline (do not rely solely on Bull dedupe — closes active-skip race).
      const result = await this.processFinalizeJob({
        jobId: job.id,
        tenantId: job.tenantId,
        reason: 'reconciliation',
      });
      if (result && isTerminalJobStatus(result.status)) {
        finalizedCount += 1;
        continue;
      }
      try {
        await this.deps.queue.enqueueFinalizeJob({
          jobId: job.id,
          tenantId: job.tenantId,
          reason: 'reconciliation',
        });
      } catch {
        // Best-effort; inline attempt already ran.
      }
    }

    // Heal stranded QUEUED items after crash mid csv-parse fan-out.
    const stranded = await this.deps.store.listJobsNeedingSubmitResume({
      olderThan,
      limit,
    });
    let resumedCount = 0;
    for (const job of stranded) {
      const queuedIds = await this.deps.store.listQueuedItemIdsByJobId(job.id);
      if (queuedIds.length === 0) continue;
      await this.deps.store.markJobProcessing(job.id);
      const storedSettings = await this.deps.store.getRuntimeSettings(job.tenantId);
      const submitBatchSize =
        storedSettings.submitBatchSize ?? DEFAULT_JOB_RUNTIME_SETTINGS.submitBatchSize;
      const batches = chunkArray(queuedIds, submitBatchSize);
      const nonce = `resume-${Date.now().toString(36)}`;
      for (const itemIds of batches) {
        try {
          await this.deps.queue.enqueueSubmitBatch({
            jobId: job.id,
            tenantId: job.tenantId,
            itemIds,
            enqueueNonce: nonce,
          });
        } catch {
          // Best-effort.
        }
      }
      resumedCount += 1;
    }

    // Empty CSV shells: re-enqueue parse or fail when file is gone / heal budget exhausted.
    // Use a longer age gate than poll interval so long stream-parses are not killed.
    const csvShellOlderThan = new Date(this.now().getTime() - 5 * 60 * 1000);
    const emptyShells = await this.deps.store.listEmptyCsvShellsNeedingHeal({
      olderThan: csvShellOlderThan,
      limit,
    });
    let csvHealed = 0;
    let csvAbandoned = 0;
    const MAX_CSV_HEALS = 3;
    for (const shell of emptyShells) {
      const heals =
        typeof shell.metadata?.csvHealAttempts === 'number'
          ? shell.metadata.csvHealAttempts
          : 0;
      const filePath =
        typeof shell.metadata?.csvFilePath === 'string'
          ? shell.metadata.csvFilePath
          : null;

      if (!filePath || heals >= MAX_CSV_HEALS) {
        await this.deps.store.finalizeJob({
          jobId: shell.id,
          status: 'FAILED',
          errorCode: 'CSV_PARSE_ABANDONED',
          errorMessage: filePath
            ? 'CSV parse heal attempts exhausted'
            : 'CSV upload file missing for empty shell',
        });
        csvAbandoned += 1;
        continue;
      }

      try {
        await access(filePath);
      } catch {
        await this.deps.store.finalizeJob({
          jobId: shell.id,
          status: 'FAILED',
          errorCode: 'CSV_PARSE_ABANDONED',
          errorMessage: 'CSV upload file missing for empty shell',
        });
        csvAbandoned += 1;
        continue;
      }

      await this.deps.store.patchJobMetadata(shell.id, {
        csvHealAttempts: heals + 1,
      });
      try {
        await this.deps.queue.enqueueCsvParse(
          {
            jobId: shell.id,
            tenantId: shell.tenantId,
            filePath,
          },
          { replaceExisting: true },
        );
        csvHealed += 1;
      } catch (error) {
        this.logger.warn('jobs.reconcile.csv_heal_enqueue_failed', {
          jobId: shell.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.info('jobs.reconcile.tick', {
      polled: stale.length,
      finalized: finalizedCount,
      needing: needing.length,
      submitResumed: resumedCount,
      csvHealed,
      csvAbandoned,
    });

    return { polled: stale.length, finalized: finalizedCount };
  }

  /**
   * Dead-letter / exhausted BullMQ attempts for a submit batch.
   * Fails only RESERVED (in-flight) items; re-enqueues remaining QUEUED with a
   * unique Bull jobId nonce so retained failed jobs cannot swallow the heal.
   */
  async markSubmitBatchDeadLetter(payload: SubmitBatchPayload, reason: string): Promise<void> {
    const MAX_DLQ_CYCLES = 3;
    const job = await this.deps.store.findJobById(payload.jobId);
    const prevCycles =
      typeof job?.metadata?.submitDlqCycles === 'number'
        ? job.metadata.submitDlqCycles
        : 0;

    for (const itemId of payload.itemIds) {
      const item = await this.deps.store.findItemById(itemId);
      if (!item || isTerminalJobItemStatus(item.status)) {
        continue;
      }
      if (item.status !== 'RESERVED') {
        continue;
      }
      const failed = await this.deps.store.transitionItem({
        jobItemId: itemId,
        fromStatuses: ['RESERVED'],
        toStatus: 'FAILED',
        patch: {
          errorCode: 'QUEUE_DEAD_LETTER',
          errorMessage: reason,
          completedAt: this.now(),
        },
      });
      if (failed) {
        await this.onItemBecameTerminal(failed, 'release');
      }
    }

    const queuedFromPayload: string[] = [];
    for (const itemId of payload.itemIds) {
      const item = await this.deps.store.findItemById(itemId);
      if (item?.status === 'QUEUED') {
        queuedFromPayload.push(itemId);
      }
    }

    if (queuedFromPayload.length > 0) {
      if (prevCycles >= MAX_DLQ_CYCLES) {
        for (const itemId of queuedFromPayload) {
          const failed = await this.deps.store.transitionItem({
            jobItemId: itemId,
            fromStatuses: ['QUEUED'],
            toStatus: 'FAILED',
            patch: {
              errorCode: 'QUEUE_DEAD_LETTER',
              errorMessage: `${reason} (dlq cycles exhausted)`,
              completedAt: this.now(),
            },
          });
          if (failed) {
            await this.onItemBecameTerminal(failed, 'release');
          }
        }
      } else {
        await this.deps.store.patchJobMetadata(payload.jobId, {
          submitDlqCycles: prevCycles + 1,
        });
        const storedSettings = await this.deps.store.getRuntimeSettings(
          payload.tenantId,
        );
        const submitBatchSize =
          storedSettings.submitBatchSize ??
          DEFAULT_JOB_RUNTIME_SETTINGS.submitBatchSize;
        const nonce = `dlq-${Date.now().toString(36)}-${prevCycles + 1}`;
        for (const itemIds of chunkArray(queuedFromPayload, submitBatchSize)) {
          await this.deps.queue.enqueueSubmitBatch(
            withRequestId(
              {
                jobId: payload.jobId,
                tenantId: payload.tenantId,
                itemIds,
                enqueueNonce: nonce,
              },
              payload.requestId,
            ),
          );
        }
        this.logger.warn('jobs.submit.dead_letter_requeued', {
          jobId: payload.jobId,
          tenantId: payload.tenantId,
          queuedCount: queuedFromPayload.length,
          dlqCycle: prevCycles + 1,
          reason,
        });
      }
    }

    await this.deps.queue.enqueueFinalizeJob(
      withRequestId(
        {
          jobId: payload.jobId,
          tenantId: payload.tenantId,
          reason: 'dead-letter',
        },
        payload.requestId,
      ),
    );
  }

  private async onItemBecameTerminal(
    item: JobItemRecord,
    billingAction: 'capture' | 'release' = 'capture',
  ): Promise<void> {
    if (item.status !== 'COMPLETED' && item.status !== 'FAILED') {
      return;
    }
    await this.billing.onItemTerminal({
      tenantId: item.tenantId,
      jobItemId: item.id,
      status: item.status,
      billingAction,
    });
    await this.webhooks.onItemTerminal({
      tenantId: item.tenantId,
      jobItemId: item.id,
      jobId: item.jobId,
      status: item.status,
    });
    await this.deps.store.refreshJobCounters(item.jobId);
  }

  private async pollDelayMs(tenantId: string): Promise<number> {
    const settings = await this.deps.store.getRuntimeSettings(tenantId);
    return settings.pollIntervalSec * 1000;
  }

  private backoffDelayMs(baseSec: number, attempt: number): number {
    const exp = Math.min(6, Math.max(0, attempt - 1));
    return baseSec * 1000 * 2 ** exp;
  }
}
