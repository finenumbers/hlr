import type { JobsBillingHooks, JobsLogger, JobsWebhookHooks } from './ports.js';

const silentLogger: JobsLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/**
 * No-op billing hooks — production uses `@finenumbers/billing` `createBillingJobsHooks`.
 * Kept for tests and local runs without a ledger.
 */
export function createNoopBillingHooks(logger: JobsLogger = silentLogger): JobsBillingHooks {
  return {
    async onItemReserved(input) {
      logger.debug('billing.hook.reserved.skipped', input);
    },
    async onItemTerminal(input) {
      logger.debug('billing.hook.terminal.skipped', input);
    },
    async onJobFinalized(input) {
      logger.debug('billing.hook.job_finalized.skipped', input);
    },
  };
}

/**
 * No-op webhook hooks — E13 will enqueue signed deliveries.
 */
export function createNoopWebhookHooks(logger: JobsLogger = silentLogger): JobsWebhookHooks {
  return {
    async onItemTerminal(input) {
      logger.debug('webhook.hook.item_terminal.skipped', input);
    },
    async onJobFinalized(input) {
      logger.debug('webhook.hook.job_finalized.skipped', input);
    },
  };
}
