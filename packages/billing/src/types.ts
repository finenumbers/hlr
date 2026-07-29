import type { CheckType, Prisma, WalletTransactionType } from '@finenumbers/db';

export type BillingCheckType = CheckType | 'HLR' | 'PING';

export type BillingLogger = {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
};

export type ResolvedTariff = {
  tariffPlanId: string;
  tariffPlanCode: string;
  tariffPlanName: string;
  tenantTariffId: string | null;
  currency: string;
  checkType: BillingCheckType;
  /** Client sell price for one check. */
  sellPrice: Prisma.Decimal;
  /** Internal provider cost for one check (not charged to client). */
  providerCost: Prisma.Decimal;
  source: 'tenant_override' | 'tenant_plan';
};

export type CostEstimate = {
  tenantId: string;
  checkType: BillingCheckType;
  unitCount: number;
  unitSellPrice: string;
  unitProviderCost: string;
  estimatedSellTotal: string;
  estimatedProviderTotal: string;
  currency: string;
  tariff: Omit<ResolvedTariff, 'sellPrice' | 'providerCost' | 'tariffPlanName'> & {
    sellPrice: string;
    providerCost: string;
  };
};

export type WalletBalances = {
  walletId: string;
  tenantId: string;
  currency: string;
  availableBalance: string;
  heldBalance: string;
  version: number;
};

export type LedgerEntryView = {
  id: string;
  walletId: string;
  tenantId: string;
  type: WalletTransactionType;
  amount: string;
  currency: string;
  balanceAfterAvailable: string | null;
  balanceAfterHeld: string | null;
  relatedHoldId: string | null;
  jobItemId: string | null;
  idempotencyKey: string | null;
  description: string | null;
  metadata: Prisma.JsonValue | null;
  createdById: string | null;
  createdAt: Date;
};

export type ReserveResult = {
  hold: LedgerEntryView;
  wallet: WalletBalances;
  tariff: CostEstimate['tariff'];
  created: boolean;
};

export type CaptureResult = {
  debit: LedgerEntryView | null;
  release: LedgerEntryView | null;
  wallet: WalletBalances;
  chargedAmount: string;
  releasedAmount: string;
  created: boolean;
};

export type ReleaseResult = {
  release: LedgerEntryView | null;
  wallet: WalletBalances;
  releasedAmount: string;
  created: boolean;
};

export type CreditResult = {
  credit: LedgerEntryView;
  wallet: WalletBalances;
  created: boolean;
};

export type AdjustmentResult = {
  adjustment: LedgerEntryView;
  wallet: WalletBalances;
  created: boolean;
};

export type AuditWriter = (input: {
  tenantId?: string | null;
  actorType: 'USER' | 'API_KEY' | 'SYSTEM';
  actorUserId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue;
}) => Promise<void>;
