/**
 * Extension point for ledger workflows (E07).
 * Implementations live in billing services / workers, not in HTTP controllers.
 */
export abstract class BillingWorkflowPort {
  abstract reserve(input: {
    tenantId: string;
    jobItemId: string;
    amount: string;
    idempotencyKey: string;
  }): Promise<void>;

  abstract capture(input: { jobItemId: string; idempotencyKey: string }): Promise<void>;

  abstract release(input: { jobItemId: string; idempotencyKey: string }): Promise<void>;

  abstract topup(input: {
    tenantId: string;
    amount: string;
    description?: string;
    createdById: string;
    /** Required — retries with the same key must not double-credit. */
    idempotencyKey: string;
  }): Promise<void>;
}

export const BILLING_WORKFLOW = Symbol('BILLING_WORKFLOW');
