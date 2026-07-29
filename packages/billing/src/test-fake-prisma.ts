/**
 * Minimal in-memory Prisma stand-in for billing unit/integration-style tests.
 * Covers wallet row-lock transactions, ledger uniqueness, tariffs, and job item cost stamps.
 */
import { Prisma } from '@finenumbers/db';
import { randomUUID } from 'node:crypto';

type WalletRow = {
  id: string;
  tenantId: string;
  currency: string;
  availableBalance: Prisma.Decimal;
  heldBalance: Prisma.Decimal;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

type TxRow = {
  id: string;
  walletId: string;
  tenantId: string;
  type: 'CREDIT' | 'DEBIT' | 'HOLD' | 'RELEASE' | 'ADJUSTMENT';
  amount: Prisma.Decimal;
  currency: string;
  balanceAfterAvailable: Prisma.Decimal | null;
  balanceAfterHeld: Prisma.Decimal | null;
  relatedHoldId: string | null;
  jobItemId: string | null;
  idempotencyKey: string | null;
  description: string | null;
  metadata: Prisma.JsonValue | null;
  createdById: string | null;
  createdAt: Date;
};

type TariffPlanRow = {
  id: string;
  code: string;
  name: string;
  currency: string;
  checkType: 'HLR' | 'PING';
  sellPrice: Prisma.Decimal;
  providerCost: Prisma.Decimal;
  isDefault: boolean;
  isActive: boolean;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type TenantTariffRow = {
  id: string;
  tenantId: string;
  checkType: 'HLR' | 'PING';
  tariffPlanId: string;
  priceOverride: Prisma.Decimal | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type JobItemRow = {
  id: string;
  jobId: string;
  tenantId: string;
  checkType: 'HLR' | 'PING';
  phoneE164: string;
  estimatedCost: Prisma.Decimal | null;
  actualCost: Prisma.Decimal | null;
  currency: string;
};

type JobRow = {
  id: string;
  tenantId: string;
  estimatedCost: Prisma.Decimal | null;
  actualCost: Prisma.Decimal | null;
};

function dec(value: unknown): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(String(value ?? 0));
}

function sortTxRows<T extends { createdAt: Date; id: string }>(
  rows: T[],
  orderBy?:
    | { createdAt: 'asc' | 'desc' }
    | Array<{ createdAt?: 'asc' | 'desc'; id?: 'asc' | 'desc' }>,
): T[] {
  const sorted = [...rows].sort((a, b) => {
    const byTime = a.createdAt.getTime() - b.createdAt.getTime();
    if (byTime !== 0) {
      return byTime;
    }
    return a.id.localeCompare(b.id);
  });
  if (!orderBy) {
    return sorted;
  }
  if (Array.isArray(orderBy)) {
    const created = orderBy.find((o) => o.createdAt)?.createdAt ?? 'asc';
    return created === 'desc' ? sorted.reverse() : sorted;
  }
  return orderBy.createdAt === 'desc' ? sorted.reverse() : sorted;
}

export class FakeBillingPrisma {
  wallets = new Map<string, WalletRow>();
  transactions: TxRow[] = [];
  tariffPlans = new Map<string, TariffPlanRow>();
  tenantTariffs = new Map<string, TenantTariffRow>();
  jobItems = new Map<string, JobItemRow>();
  jobs = new Map<string, JobRow>();

  wallet = {
    findUnique: async ({ where }: { where: { tenantId?: string; id?: string } }) => {
      if (where.tenantId) {
        return [...this.wallets.values()].find((w) => w.tenantId === where.tenantId) ?? null;
      }
      if (where.id) {
        return this.wallets.get(where.id) ?? null;
      }
      return null;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const tenantId = String(data.tenantId);
      if ([...this.wallets.values()].some((w) => w.tenantId === tenantId)) {
        const err = new Error('Unique constraint') as Error & { code: string };
        err.code = 'P2002';
        throw err;
      }
      const row: WalletRow = {
        id: randomUUID(),
        tenantId,
        currency: String(data.currency ?? 'RUB'),
        availableBalance: dec(data.availableBalance ?? 0),
        heldBalance: dec(data.heldBalance ?? 0),
        version: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.wallets.set(row.id, row);
      return { ...row };
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const row = this.wallets.get(where.id);
      if (!row) {
        throw new Error('wallet not found');
      }
      if (data.availableBalance !== undefined) {
        row.availableBalance = dec(data.availableBalance);
      }
      if (data.heldBalance !== undefined) {
        row.heldBalance = dec(data.heldBalance);
      }
      if (
        data.version &&
        typeof data.version === 'object' &&
        data.version !== null &&
        'increment' in data.version
      ) {
        row.version += Number((data.version as { increment: number }).increment);
      }
      row.updatedAt = new Date();
      return { ...row };
    },
  };

  walletTransaction = {
    findUnique: async ({
      where,
    }: {
      where: { tenantId_idempotencyKey: { tenantId: string; idempotencyKey: string } };
    }) => {
      const { tenantId, idempotencyKey } = where.tenantId_idempotencyKey;
      return (
        this.transactions.find(
          (t) => t.tenantId === tenantId && t.idempotencyKey === idempotencyKey,
        ) ?? null
      );
    },
    count: async ({ where }: { where?: { walletId?: string } } = {}) => {
      let rows = [...this.transactions];
      if (where?.walletId) {
        rows = rows.filter((t) => t.walletId === where.walletId);
      }
      return rows.length;
    },
    findFirst: async ({
      where,
      orderBy,
    }: {
      where: Record<string, unknown>;
      orderBy?: { createdAt: 'asc' | 'desc' } | Array<{ createdAt?: 'asc' | 'desc'; id?: 'asc' | 'desc' }>;
    }) => {
      let rows = [...this.transactions];
      if (where.jobItemId) {
        rows = rows.filter((t) => t.jobItemId === where.jobItemId);
      }
      if (where.relatedHoldId) {
        rows = rows.filter((t) => t.relatedHoldId === where.relatedHoldId);
      }
      if (
        where.type &&
        typeof where.type === 'object' &&
        where.type !== null &&
        'in' in where.type
      ) {
        const set = new Set((where.type as { in: string[] }).in);
        rows = rows.filter((t) => set.has(t.type));
      } else if (typeof where.type === 'string') {
        rows = rows.filter((t) => t.type === where.type);
      }
      rows = sortTxRows(rows, orderBy);
      return rows[0] ?? null;
    },
    findMany: async ({
      where,
      orderBy,
      select,
    }: {
      where?: Record<string, unknown>;
      orderBy?:
        | { createdAt: 'asc' | 'desc' }
        | Array<{ createdAt?: 'asc' | 'desc'; id?: 'asc' | 'desc' }>;
      select?: Record<string, boolean>;
    }) => {
      let rows = [...this.transactions];
      if (where?.walletId) {
        rows = rows.filter((t) => t.walletId === where.walletId);
      }
      if (where?.jobItemId !== undefined) {
        if (
          typeof where.jobItemId === 'object' &&
          where.jobItemId !== null &&
          'in' in where.jobItemId
        ) {
          const set = new Set((where.jobItemId as { in: string[] }).in);
          rows = rows.filter((t) => t.jobItemId !== null && set.has(t.jobItemId));
        } else {
          rows = rows.filter((t) => t.jobItemId === where.jobItemId);
        }
      }
      if (where?.relatedHoldId) {
        rows = rows.filter((t) => t.relatedHoldId === where.relatedHoldId);
      }
      if (
        where?.type &&
        typeof where.type === 'object' &&
        where.type !== null &&
        'in' in where.type
      ) {
        const set = new Set((where.type as { in: string[] }).in);
        rows = rows.filter((t) => set.has(t.type));
      }
      rows = sortTxRows(rows, orderBy);
      if (select) {
        return rows.map((row) => {
          const out: Record<string, unknown> = {};
          for (const key of Object.keys(select)) {
            out[key] = (row as Record<string, unknown>)[key];
          }
          return out;
        });
      }
      return rows;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      if (data.idempotencyKey) {
        const dup = this.transactions.find(
          (t) =>
            t.tenantId === data.tenantId && t.idempotencyKey === data.idempotencyKey,
        );
        if (dup) {
          const err = new Error('Unique constraint') as Error & { code: string };
          err.code = 'P2002';
          throw err;
        }
      }
      const row: TxRow = {
        id: randomUUID(),
        walletId: String(data.walletId),
        tenantId: String(data.tenantId),
        type: data.type as TxRow['type'],
        amount: dec(data.amount),
        currency: String(data.currency ?? 'RUB'),
        balanceAfterAvailable:
          data.balanceAfterAvailable === undefined || data.balanceAfterAvailable === null
            ? null
            : dec(data.balanceAfterAvailable),
        balanceAfterHeld:
          data.balanceAfterHeld === undefined || data.balanceAfterHeld === null
            ? null
            : dec(data.balanceAfterHeld),
        relatedHoldId: (data.relatedHoldId as string | null | undefined) ?? null,
        jobItemId: (data.jobItemId as string | null | undefined) ?? null,
        idempotencyKey: (data.idempotencyKey as string | null | undefined) ?? null,
        description: (data.description as string | null | undefined) ?? null,
        metadata: (data.metadata as Prisma.JsonValue | null | undefined) ?? null,
        createdById: (data.createdById as string | null | undefined) ?? null,
        createdAt: new Date(),
      };
      this.transactions.push(row);
      return { ...row };
    },
  };

  tenantTariff = {
    findUnique: async ({
      where,
      include,
    }: {
      where: {
        tenantId?: string;
        tenantId_checkType?: { tenantId: string; checkType: 'HLR' | 'PING' };
      };
      include?: { tariffPlan: boolean };
    }) => {
      let row: TenantTariffRow | undefined;
      if (where.tenantId_checkType) {
        const { tenantId, checkType } = where.tenantId_checkType;
        row = [...this.tenantTariffs.values()].find(
          (t) => t.tenantId === tenantId && t.checkType === checkType,
        );
      } else if (where.tenantId) {
        row = [...this.tenantTariffs.values()].find((t) => t.tenantId === where.tenantId);
      }
      if (!row) {
        return null;
      }
      if (include?.tariffPlan) {
        const plan = this.tariffPlans.get(row.tariffPlanId);
        return { ...row, tariffPlan: plan };
      }
      return { ...row };
    },
  };

  tariffPlan = {
    findFirst: async ({
      where,
      orderBy,
    }: {
      where: { isDefault?: boolean; isActive?: boolean; checkType?: 'HLR' | 'PING' };
      orderBy?: { createdAt: 'asc' | 'desc' };
    }) => {
      let rows = [...this.tariffPlans.values()];
      if (where.isDefault !== undefined) {
        rows = rows.filter((p) => p.isDefault === where.isDefault);
      }
      if (where.isActive !== undefined) {
        rows = rows.filter((p) => p.isActive === where.isActive);
      }
      if (where.checkType !== undefined) {
        rows = rows.filter((p) => p.checkType === where.checkType);
      }
      rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      if (orderBy?.createdAt === 'desc') {
        rows.reverse();
      }
      return rows[0] ?? null;
    },
  };

  jobItem = {
    findUnique: async ({
      where,
      select,
    }: {
      where: { id: string };
      select?: Record<string, boolean>;
    }) => {
      const row = this.jobItems.get(where.id);
      if (!row) {
        return null;
      }
      if (!select) {
        return { ...row };
      }
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(select)) {
        out[key] = (row as Record<string, unknown>)[key];
      }
      return out;
    },
    findMany: async ({
      where,
      select,
    }: {
      where: { jobId?: string; id?: { in: string[] } };
      select?: Record<string, boolean>;
    }) => {
      let rows = [...this.jobItems.values()];
      if (where.jobId) {
        rows = rows.filter((i) => i.jobId === where.jobId);
      }
      if (where.id && 'in' in where.id) {
        const set = new Set(where.id.in);
        rows = rows.filter((i) => set.has(i.id));
      }
      if (!select) {
        return rows;
      }
      return rows.map((row) => {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(select)) {
          out[key] = (row as Record<string, unknown>)[key];
        }
        return out;
      });
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const row = this.jobItems.get(where.id);
      if (!row) {
        throw new Error('job item not found');
      }
      if (data.estimatedCost !== undefined) {
        row.estimatedCost = data.estimatedCost === null ? null : dec(data.estimatedCost);
      }
      if (data.actualCost !== undefined) {
        row.actualCost = data.actualCost === null ? null : dec(data.actualCost);
      }
      if (data.currency !== undefined) {
        row.currency = String(data.currency);
      }
      return { ...row };
    },
  };

  job = {
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const row = this.jobs.get(where.id);
      if (!row) {
        throw new Error('job not found');
      }
      if (data.estimatedCost !== undefined) {
        row.estimatedCost = data.estimatedCost === null ? null : dec(data.estimatedCost);
      }
      if (data.actualCost !== undefined) {
        row.actualCost = data.actualCost === null ? null : dec(data.actualCost);
      }
      return { ...row };
    },
  };

  async $transaction<T>(
    fn: (tx: FakeBillingPrisma) => Promise<T>,
    _opts?: unknown,
  ): Promise<T> {
    return fn(this);
  }

  async $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T> {
    const sql = strings.join('?');
    if (sql.includes('FROM wallets') && sql.includes('FOR UPDATE')) {
      const tenantId = String(values[0]);
      const wallet = [...this.wallets.values()].find((w) => w.tenantId === tenantId);
      return (wallet ? [wallet] : []) as T;
    }
    throw new Error(`Unsupported raw query in fake: ${sql}`);
  }

  seedWallet(tenantId: string, available: string, held = '0'): WalletRow {
    const row: WalletRow = {
      id: randomUUID(),
      tenantId,
      currency: 'RUB',
      availableBalance: dec(available),
      heldBalance: dec(held),
      version: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.wallets.set(row.id, row);
    return row;
  }

  seedPlan(input: {
    code: string;
    sellPrice: string;
    providerCost?: string;
    checkType?: 'HLR' | 'PING';
    isDefault?: boolean;
  }): TariffPlanRow {
    const row: TariffPlanRow = {
      id: randomUUID(),
      code: input.code,
      name: input.code,
      currency: 'RUB',
      checkType: input.checkType ?? 'HLR',
      sellPrice: dec(input.sellPrice),
      providerCost: dec(input.providerCost ?? '0'),
      isDefault: input.isDefault ?? false,
      isActive: true,
      description: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.tariffPlans.set(row.id, row);
    return row;
  }

  /** Seed an HLR plan and assign it to the tenant (typical test setup). */
  seedAssignedPlan(
    tenantId: string,
    input: {
      code: string;
      sellPrice: string;
      providerCost?: string;
      checkType?: 'HLR' | 'PING';
      priceOverride?: string;
    },
  ): TariffPlanRow {
    const plan = this.seedPlan(input);
    this.assignTenantTariff(tenantId, plan.id, {
      checkType: plan.checkType,
      priceOverride: input.priceOverride,
    });
    return plan;
  }

  assignTenantTariff(
    tenantId: string,
    planId: string,
    opts?: { checkType?: 'HLR' | 'PING'; priceOverride?: string },
  ): TenantTariffRow {
    const plan = this.tariffPlans.get(planId);
    const checkType = opts?.checkType ?? plan?.checkType ?? 'HLR';
    const row: TenantTariffRow = {
      id: randomUUID(),
      tenantId,
      checkType,
      tariffPlanId: planId,
      priceOverride: opts?.priceOverride ? dec(opts.priceOverride) : null,
      effectiveFrom: new Date(Date.now() - 60_000),
      effectiveTo: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    // Replace existing assignment for this tenant+type
    for (const [id, existing] of this.tenantTariffs) {
      if (existing.tenantId === tenantId && existing.checkType === checkType) {
        this.tenantTariffs.delete(id);
      }
    }
    this.tenantTariffs.set(row.id, row);
    return row;
  }

  seedJobItem(tenantId: string, jobId = randomUUID()): JobItemRow {
    const row: JobItemRow = {
      id: randomUUID(),
      jobId,
      tenantId,
      checkType: 'HLR',
      phoneE164: '+79001234567',
      estimatedCost: null,
      actualCost: null,
      currency: 'RUB',
    };
    this.jobItems.set(row.id, row);
    if (!this.jobs.has(jobId)) {
      this.jobs.set(jobId, {
        id: jobId,
        tenantId,
        estimatedCost: null,
        actualCost: null,
      });
    }
    return row;
  }
}
