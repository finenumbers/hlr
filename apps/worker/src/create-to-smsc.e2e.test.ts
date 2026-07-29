/**
 * Worker e2e (no Redis/Bull): create job → reserve → mocked SMSC → capture/finalize.
 * Mirrors apps/worker wiring with InMemory store/queue + FakeBillingPrisma.
 */
import {
  BillingService,
  createBillingJobsHooks,
  jobPriceSnapshotFromEstimate,
} from '@finenumbers/billing';
import { FakeBillingPrisma } from '@finenumbers/billing/testing';
import type { PrismaClient } from '@finenumbers/db';
import {
  CreateJobService,
  InMemoryJobsQueue,
  InMemoryJobsStore,
  JobLifecycleService,
  type JobsProviderPort,
} from '@finenumbers/jobs';
import { describe, expect, it, vi } from 'vitest';

type State = 'none' | 'hlr-only' | 'ping-only' | 'both';

function seedState(state: State) {
  const db = new FakeBillingPrisma();
  const tenantId = `worker-${state}`;
  db.seedWallet(tenantId, '50');
  if (state === 'hlr-only' || state === 'both') {
    db.seedAssignedPlan(tenantId, {
      code: 'hlr-w',
      sellPrice: '1.500000',
      providerCost: '0.400000',
      checkType: 'HLR',
    });
  }
  if (state === 'ping-only' || state === 'both') {
    db.seedAssignedPlan(tenantId, {
      code: 'ping-w',
      sellPrice: '2.500000',
      providerCost: '0.800000',
      checkType: 'PING',
    });
  }
  return {
    db,
    billing: new BillingService({ prisma: db as unknown as PrismaClient }),
    tenantId,
  };
}

function mockProvider(checkType: 'HLR' | 'PING'): JobsProviderPort {
  const submit = vi.fn(async (input: { phoneE164: string; jobItemId: string }) => ({
    providerCode: 'smsc' as const,
    checkType,
    providerMessageId: `w-${input.jobItemId}`,
    accepted: true,
    deduplicated: false,
    cost: null,
    balance: null,
    normalized: {
      providerCode: 'smsc' as const,
      checkType,
      providerMessageId: `w-${input.jobItemId}`,
      phoneE164: input.phoneE164,
      lifecycleStatus: 'completed' as const,
      resultStatus: 'reachable',
      isReachable: true,
      imsi: null,
      mcc: null,
      mnc: null,
      operatorName: null,
      countryCode: null,
      ported: null,
      roaming: null,
      providerErrorCode: null,
      providerErrorMessage: null,
      providerStatusCode: null,
      cost: null,
      currency: null,
      extras: {},
    },
    rawRequest: {},
    rawResponse: {},
    providerRequestId: `req-${input.jobItemId}`,
  }));
  return {
    submitHlr: checkType === 'HLR' ? submit : vi.fn(),
    submitPing: checkType === 'PING' ? submit : vi.fn(),
    fetchStatus: vi.fn(),
  };
}

async function runWorkerPipeline(input: {
  state: State;
  checkType: 'HLR' | 'PING';
}) {
  const { db, billing, tenantId } = seedState(input.state);
  const store = new InMemoryJobsStore();
  const queue = new InMemoryJobsQueue();
  const provider = mockProvider(input.checkType);
  const createJob = new CreateJobService({ store, queue });
  const lifecycle = new JobLifecycleService({
    store,
    queue,
    provider,
    billing: createBillingJobsHooks(billing),
  });

  const estimate = await billing.assertCanAfford({
    tenantId,
    checkType: input.checkType,
    unitCount: 1,
  });

  const created = await createJob.create({
    tenantId,
    checkType: input.checkType,
    source: 'API',
    phones: ['+79991234567'],
    currency: estimate.currency,
    priceSnapshot: jobPriceSnapshotFromEstimate(estimate),
  });

  const submit = queue.of('submit')[0]!.payload as {
    jobId: string;
    tenantId: string;
    itemIds: string[];
  };
  for (const item of await store.listItemsByIds(submit.itemIds)) {
    db.importJobItem(item);
  }

  await lifecycle.processSubmitBatch(submit);

  // Terminal result on submit (lifecycleStatus final) → capture path via onItemTerminal
  const item = await store.findItemById(submit.itemIds[0]!);
  const finalizeMsgs = queue.of('finalize');
  if (finalizeMsgs.length) {
    await lifecycle.processFinalizeJob(
      finalizeMsgs[0]!.payload as { jobId: string; tenantId: string },
    );
  }

  return {
    db,
    store,
    provider,
    created,
    item,
    job: await store.findJobById(created.job.id),
  };
}

describe('Worker e2e create → SMSC → finalize', () => {
  it('hlr-only: HLR reaches SMSC, HOLD then capture', async () => {
    const result = await runWorkerPipeline({ state: 'hlr-only', checkType: 'HLR' });
    expect(result.provider.submitHlr).toHaveBeenCalledTimes(1);
    expect(result.provider.submitPing).not.toHaveBeenCalled();
    expect(result.item?.status).toBe('COMPLETED');
    expect(result.db.transactions.some((t) => t.type === 'HOLD')).toBe(true);
    expect(result.db.transactions.some((t) => t.type === 'DEBIT')).toBe(true);
  });

  it('ping-only: Ping reaches SMSC', async () => {
    const result = await runWorkerPipeline({ state: 'ping-only', checkType: 'PING' });
    expect(result.provider.submitPing).toHaveBeenCalledTimes(1);
    expect(result.provider.submitHlr).not.toHaveBeenCalled();
    expect(result.item?.checkType).toBe('PING');
    expect(result.item?.status).toBe('COMPLETED');
  });

  it('both: each product uses its own SMSC method', async () => {
    const hlr = await runWorkerPipeline({ state: 'both', checkType: 'HLR' });
    const ping = await runWorkerPipeline({ state: 'both', checkType: 'PING' });
    expect(hlr.provider.submitHlr).toHaveBeenCalled();
    expect(ping.provider.submitPing).toHaveBeenCalled();
  });

  it('none: create blocked before enqueue (worker never sees job)', async () => {
    const { billing, tenantId } = seedState('none');
    await expect(
      billing.assertCanAfford({ tenantId, checkType: 'HLR', unitCount: 1 }),
    ).rejects.toMatchObject({ code: 'TARIFF_NOT_CONFIGURED' });
  });

  it('hlr-only: Ping create blocked', async () => {
    const { billing, tenantId } = seedState('hlr-only');
    await expect(
      billing.assertCanAfford({ tenantId, checkType: 'PING', unitCount: 1 }),
    ).rejects.toMatchObject({ code: 'TARIFF_NOT_CONFIGURED' });
  });
});
