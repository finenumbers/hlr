export { BillingService } from './billing.service.js';
export type { BillingServiceDeps } from './billing.service.js';

export { LedgerService } from './ledger.service.js';
export type { CreateLedgerEntryInput, DbClient } from './ledger.service.js';

export {
  foldLedgerBalances,
  projectedBalancesToView,
  balancesMatchCache,
} from './ledger-projection.js';
export type {
  LedgerProjectionRow,
  ProjectedBalances,
  ProjectedBalancesView,
} from './ledger-projection.js';

export { TariffResolver } from './tariff-resolver.js';

export { BillingError, isBillingError } from './errors.js';
export type { BillingErrorCode } from './errors.js';

export {
  money,
  moneyZero,
  moneyFromSafeInteger,
  moneyToString,
  moneyEquals,
  moneyAdd,
  moneySub,
  moneyMul,
  moneyMin,
  assertPositiveMoney,
  assertNonNegativeMoney,
} from './money.js';
export type { MoneyInput } from './money.js';

export {
  holdIdempotencyKey,
  debitIdempotencyKey,
  releaseIdempotencyKey,
  releaseRemainderIdempotencyKey,
  topupIdempotencyKey,
  adjustmentIdempotencyKey,
} from './idempotency.js';

export { createBillingJobsHooks } from './jobs-billing.hooks.js';
export type { JobsBillingHooksLike } from './jobs-billing.hooks.js';

export type {
  AdjustmentResult,
  AuditWriter,
  BillingCheckType,
  BillingLogger,
  CaptureResult,
  CostEstimate,
  CreditResult,
  LedgerEntryView,
  ReleaseResult,
  ReserveResult,
  ResolvedTariff,
  WalletBalances,
} from './types.js';
