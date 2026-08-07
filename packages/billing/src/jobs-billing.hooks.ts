import type { BillingService } from './billing.service.js';
import { isBillingError } from './errors.js';
import type { BillingLogger } from './types.js';

/**
 * Adapter from `@finenumbers/jobs` billing hooks to the ledger BillingService.
 * Shape matches JobsBillingHooks without a hard dependency on the jobs package.
 */
export type JobsBillingHooksLike = {
  onItemReserved(input: {
    tenantId: string;
    jobItemId: string;
    checkType: 'HLR' | 'PING';
  }): Promise<void>;

  onItemTerminal(input: {
    tenantId: string;
    jobItemId: string;
    status: 'COMPLETED' | 'FAILED';
    billingAction: 'capture' | 'release';
  }): Promise<void>;

  onJobFinalized(input: {
    tenantId: string;
    jobId: string;
    status: string;
  }): Promise<void>;
};

const silentLogger: BillingLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

export function createBillingJobsHooks(
  billing: BillingService,
  logger: BillingLogger = silentLogger,
): JobsBillingHooksLike {
  return {
    async onItemReserved(input) {
      try {
        const result = await billing.reserveForJobItem({
          tenantId: input.tenantId,
          jobItemId: input.jobItemId,
          checkType: input.checkType,
        });
        logger.info('billing.hook.reserved', {
          tenantId: input.tenantId,
          jobItemId: input.jobItemId,
          created: result.created,
          amount: result.hold.amount,
        });
      } catch (error) {
        if (isBillingError(error)) {
          logger.warn('billing.hook.reserved_failed', {
            tenantId: input.tenantId,
            jobItemId: input.jobItemId,
            code: error.code,
            message: error.message,
          });
        }
        throw error;
      }
    },

    async onItemTerminal(input) {
      if (input.billingAction === 'release') {
        const result = await billing.releaseForJobItem({
          tenantId: input.tenantId,
          jobItemId: input.jobItemId,
          reason: `job_item_${input.status.toLowerCase()}`,
        });
        logger.info('billing.hook.released', {
          tenantId: input.tenantId,
          jobItemId: input.jobItemId,
          created: result.created,
          releasedAmount: result.releasedAmount,
        });
        return;
      }

      // Policy B: capture full reserved sell price on provider final status (incl. err).
      const result = await billing.captureForJobItem({
        tenantId: input.tenantId,
        jobItemId: input.jobItemId,
      });
      logger.info('billing.hook.captured', {
        tenantId: input.tenantId,
        jobItemId: input.jobItemId,
        created: result.created,
        chargedAmount: result.chargedAmount,
        releasedAmount: result.releasedAmount,
      });
    },

    async onJobFinalized(input) {
      const settled = await billing.settleUnsettledHoldsForJob(input.jobId);
      if (settled.captured > 0 || settled.released > 0) {
        logger.info('billing.hook.job_finalized_holds_settled', {
          tenantId: input.tenantId,
          jobId: input.jobId,
          ...settled,
        });
      }
      const costs = await billing.reconcileJobCosts(input.jobId);
      logger.info('billing.hook.job_finalized', {
        tenantId: input.tenantId,
        jobId: input.jobId,
        status: input.status,
        ...costs,
        ...settled,
      });
    },
  };
}
