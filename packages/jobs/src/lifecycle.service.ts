import type { NormalizedResult } from '@finenumbers/provider-core';
import { isProviderError } from '@finenumbers/provider-core';

import { createNoopBillingHooks, createNoopWebhookHooks } from './hooks.js';
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
   * Safe under duplicate delivery.
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

    const next = mapProviderLifecycleToItemStatus(
      input.normalized.lifecycleStatus,
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

    if (next === 'PENDING' && item.status === 'PENDING') {
      // Soft update of normalized fields without status change.
      const patched = await this.deps.store.transitionItem({
        jobItemId: item.id,
        fromStatuses: ['PENDING', 'SENT'],
        toStatus: 'PENDING',
        patch: {
          ...normalizedToPatch(input.normalized),
          providerMessageId:
            input.normalized.providerMessageId ?? item.providerMessageId,
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
          ...normalizedToPatch(input.normalized),
          providerMessageId:
            input.normalized.providerMessageId ?? item.providerMessageId,
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
        ...normalizedToPatch(input.normalized),
        providerMessageId:
          input.normalized.providerMessageId ?? item.providerMessageId,
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

  async processFinalizeJob(payload: FinalizeJobPayload): Promise<JobRecord | null> {
    const job = await this.deps.store.refreshJobCounters(payload.jobId);
    if (job.tenantId !== payload.tenantId) {
      throw new JobsNotFoundError(`Job ${payload.jobId} not found for tenant`);
    }
    if (isTerminalJobStatus(job.status)) {
      // Idempotent settle/reconcile if a prior finalize committed status but billing failed.
      await this.safeBillingOnJobFinalized(job);
      return job;
    }

    const progress = computeProgress(job);
    if (progress.pending > 0) {
      this.logger.debug('jobs.finalize.waiting', {
        jobId: job.id,
        ...progress,
        reason: payload.reason,
      });
      return job;
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
    for (const job of needing) {
      await this.deps.queue.enqueueFinalizeJob({
        jobId: job.id,
        tenantId: job.tenantId,
        reason: 'reconciliation',
      });
    }

    this.logger.info('jobs.reconcile.tick', {
      polled: stale.length,
      finalized: needing.length,
    });

    return { polled: stale.length, finalized: needing.length };
  }

  /**
   * Dead-letter / exhausted BullMQ attempts for a submit batch item set.
   * Marks still-open items as FAILED so the job can finalize.
   */
  async markSubmitBatchDeadLetter(payload: SubmitBatchPayload, reason: string): Promise<void> {
    for (const itemId of payload.itemIds) {
      const item = await this.deps.store.findItemById(itemId);
      if (!item || isTerminalJobItemStatus(item.status)) {
        continue;
      }
      if (item.status !== 'QUEUED' && item.status !== 'RESERVED') {
        continue;
      }
      const failed = await this.deps.store.transitionItem({
        jobItemId: itemId,
        fromStatuses: ['QUEUED', 'RESERVED'],
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
