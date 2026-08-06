import type {
  FetchStatusResult,
  NormalizedResult,
  SubmitCheckResult,
} from '@finenumbers/provider-core';
import { ProviderError } from '@finenumbers/provider-core';
import { describe, expect, it, vi } from 'vitest';

import { JobLifecycleService } from './lifecycle.service.js';
import { InMemoryJobsQueue } from './memory-queue.js';
import { InMemoryJobsStore } from './memory-store.js';
import type { JobsProviderPort } from './ports.js';

function baseNormalized(
  overrides: Partial<NormalizedResult> = {},
): NormalizedResult {
  return {
    providerCode: 'smsc',
    checkType: 'HLR',
    providerMessageId: 'msg-1',
    phoneE164: '+79991234567',
    lifecycleStatus: 'pending',
    resultStatus: 'pending',
    isReachable: null,
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
    ...overrides,
  };
}

function submitResult(
  overrides: Partial<SubmitCheckResult> = {},
): SubmitCheckResult {
  return {
    providerCode: 'smsc',
    checkType: 'HLR',
    providerMessageId: 'msg-1',
    accepted: true,
    deduplicated: false,
    cost: null,
    balance: null,
    normalized: baseNormalized({ lifecycleStatus: 'accepted' }),
    rawRequest: {},
    rawResponse: {},
    providerRequestId: 'req-1',
    ...overrides,
  };
}

describe('JobLifecycleService', () => {
  async function seedJob(store: InMemoryJobsStore, phones = ['+79991234567', '+79997654321']) {
    return store.createJobWithItems({
      tenantId: 'tenant-1',
      checkType: 'HLR',
      source: 'BULK',
      phones,
      idempotencyKey: null,
      createdByUserId: null,
      apiKeyId: null,
      originalFilename: null,
      currency: 'RUB',
      metadata: null,
    });
  }

  it('submits batch, schedules poll, and isolates item failures', async () => {
    const store = new InMemoryJobsStore();
    const queue = new InMemoryJobsQueue();
    const { job, items } = await seedJob(store);

    const provider: JobsProviderPort = {
      submitHlr: vi.fn(async (input) => {
        if (input.phoneE164 === '+79997654321') {
          throw new ProviderError({
            providerCode: 'smsc',
            kind: 'validation',
            message: 'bad number at provider',
            retryable: false,
          });
        }
        return submitResult({
          providerMessageId: `msg-${input.jobItemId}`,
          normalized: baseNormalized({
            phoneE164: input.phoneE164,
            providerMessageId: `msg-${input.jobItemId}`,
            lifecycleStatus: 'accepted',
          }),
        });
      }),
      submitPing: vi.fn(),
      fetchStatus: vi.fn(),
    };

    const lifecycle = new JobLifecycleService({ store, queue, provider });
    const result = await lifecycle.processSubmitBatch({
      jobId: job.id,
      tenantId: job.tenantId,
      itemIds: items.map((i) => i.id),
    });

    expect(result.submitted).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(0);

    const ok = await store.findItemById(items[0]!.id);
    const bad = await store.findItemById(items[1]!.id);
    expect(ok?.status).toBe('PENDING');
    expect(bad?.status).toBe('FAILED');

    expect(queue.of('poll')).toHaveLength(1);
    expect(queue.of('finalize').length).toBeGreaterThanOrEqual(1);

    const refreshed = await store.findJobById(job.id);
    expect(refreshed?.status).toBe('PROCESSING');
    expect(refreshed?.failureCount).toBe(1);
  });

  it('marks item FAILED with billing error code when reserve rejects', async () => {
    const store = new InMemoryJobsStore();
    const queue = new InMemoryJobsQueue();
    const { job, items } = await seedJob(store, ['+79991234567']);

    const billingError = Object.assign(new Error('No HLR tariff assigned'), {
      name: 'BillingError',
      code: 'TARIFF_NOT_CONFIGURED',
    });

    const provider: JobsProviderPort = {
      submitHlr: vi.fn(),
      submitPing: vi.fn(),
      fetchStatus: vi.fn(),
    };

    const lifecycle = new JobLifecycleService({
      store,
      queue,
      provider,
      billing: {
        onItemReserved: async () => {
          throw billingError;
        },
        onItemTerminal: async () => {},
        onJobFinalized: async () => {},
      },
    });

    await lifecycle.processSubmitBatch({
      jobId: job.id,
      tenantId: job.tenantId,
      itemIds: [items[0]!.id],
    });

    const item = await store.findItemById(items[0]!.id);
    expect(item?.status).toBe('FAILED');
    expect(item?.errorCode).toBe('TARIFF_NOT_CONFIGURED');
    expect(provider.submitHlr).not.toHaveBeenCalled();
  });

  it('PING job calls submitPing and never submitHlr (regression)', async () => {
    const store = new InMemoryJobsStore();
    const queue = new InMemoryJobsQueue();
    const { job, items } = await store.createJobWithItems({
      tenantId: 'tenant-1',
      checkType: 'PING',
      source: 'SINGLE',
      phones: ['+79991234567'],
      idempotencyKey: null,
      createdByUserId: null,
      apiKeyId: null,
      originalFilename: null,
      currency: 'RUB',
      priceSnapshot: {
        unitSellPrice: '2.5',
        unitProviderCost: '0.8',
        tariffPlanId: 'plan-ping',
        tariffPlanCode: 'ping-std',
        currency: 'RUB',
      },
      metadata: null,
    });

    const provider: JobsProviderPort = {
      submitHlr: vi.fn(),
      submitPing: vi.fn(async (input) =>
        submitResult({
          checkType: 'PING',
          providerMessageId: `ping-${input.jobItemId}`,
          normalized: baseNormalized({
            checkType: 'PING',
            phoneE164: input.phoneE164,
            providerMessageId: `ping-${input.jobItemId}`,
            lifecycleStatus: 'accepted',
          }),
        }),
      ),
      fetchStatus: vi.fn(),
    };

    const lifecycle = new JobLifecycleService({
      store,
      queue,
      provider,
      billing: {
        onItemReserved: async () => {},
        onItemTerminal: async () => {},
        onJobFinalized: async () => {},
      },
    });

    await lifecycle.processSubmitBatch({
      jobId: job.id,
      tenantId: job.tenantId,
      itemIds: [items[0]!.id],
    });

    expect(provider.submitPing).toHaveBeenCalledTimes(1);
    expect(provider.submitHlr).not.toHaveBeenCalled();
    const item = await store.findItemById(items[0]!.id);
    expect(['SENT', 'PENDING']).toContain(item?.status);
    expect(item?.checkType).toBe('PING');
    expect(item?.errorCode).toBeNull();
  });

  it('PING reserve TARIFF_NOT_CONFIGURED does not call provider (regression)', async () => {
    const store = new InMemoryJobsStore();
    const queue = new InMemoryJobsQueue();
    const { job, items } = await store.createJobWithItems({
      tenantId: 'tenant-1',
      checkType: 'PING',
      source: 'SINGLE',
      phones: ['+79991234567'],
      idempotencyKey: null,
      createdByUserId: null,
      apiKeyId: null,
      originalFilename: null,
      currency: 'RUB',
      priceSnapshot: {
        unitSellPrice: '2.5',
        unitProviderCost: '0.8',
        tariffPlanId: 'plan-ping',
        tariffPlanCode: 'ping-std',
        currency: 'RUB',
      },
      metadata: null,
    });

    const provider: JobsProviderPort = {
      submitHlr: vi.fn(),
      submitPing: vi.fn(),
      fetchStatus: vi.fn(),
    };

    const lifecycle = new JobLifecycleService({
      store,
      queue,
      provider,
      billing: {
        onItemReserved: async () => {
          throw Object.assign(new Error('No Ping tariff'), {
            name: 'BillingError',
            code: 'TARIFF_NOT_CONFIGURED',
          });
        },
        onItemTerminal: async () => {},
        onJobFinalized: async () => {},
      },
    });

    await lifecycle.processSubmitBatch({
      jobId: job.id,
      tenantId: job.tenantId,
      itemIds: [items[0]!.id],
    });

    expect(provider.submitPing).not.toHaveBeenCalled();
    expect(provider.submitHlr).not.toHaveBeenCalled();
    expect((await store.findItemById(items[0]!.id))?.errorCode).toBe('TARIFF_NOT_CONFIGURED');
  });

  it('retries retryable submit errors via BullMQ (keeps RESERVED)', async () => {
    const store = new InMemoryJobsStore();
    const queue = new InMemoryJobsQueue();
    const { job, items } = await seedJob(store, ['+79991234567']);

    const provider: JobsProviderPort = {
      submitHlr: vi.fn(async () => {
        throw new ProviderError({
          providerCode: 'smsc',
          kind: 'timeout',
          message: 'timeout',
          retryable: true,
        });
      }),
      submitPing: vi.fn(),
      fetchStatus: vi.fn(),
    };

    const lifecycle = new JobLifecycleService({ store, queue, provider });
    await expect(
      lifecycle.processSubmitBatch({
        jobId: job.id,
        tenantId: job.tenantId,
        itemIds: [items[0]!.id],
      }),
    ).rejects.toBeInstanceOf(ProviderError);

    const item = await store.findItemById(items[0]!.id);
    expect(item?.status).toBe('RESERVED');
  });

  it('updates progress on poll completion and finalizes job', async () => {
    const store = new InMemoryJobsStore();
    const queue = new InMemoryJobsQueue();
    const { job, items } = await seedJob(store, ['+79991234567']);
    const item = items[0]!;

    await store.claimItemForSubmit(item.id);
    await store.updateItemAfterSubmit({
      jobItemId: item.id,
      status: 'PENDING',
      providerMessageId: 'msg-1',
      providerCode: 'smsc',
      sentAt: new Date(),
    });
    await store.markJobProcessing(job.id);

    const provider: JobsProviderPort = {
      submitHlr: vi.fn(),
      submitPing: vi.fn(),
      fetchStatus: vi.fn(
        async (): Promise<FetchStatusResult> => ({
          providerCode: 'smsc',
          providerMessageId: 'msg-1',
          normalized: baseNormalized({
            lifecycleStatus: 'completed',
            resultStatus: 'reachable',
            isReachable: true,
          }),
          rawRequest: {},
          rawResponse: {},
          providerRequestId: 'st-1',
        }),
      ),
    };

    const lifecycle = new JobLifecycleService({ store, queue, provider });
    const poll = await lifecycle.processPollItem({
      jobItemId: item.id,
      tenantId: 'tenant-1',
      attempt: 1,
    });
    expect(poll.status).toBe('COMPLETED');
    expect(poll.rescheduled).toBe(false);

    const finalized = await lifecycle.processFinalizeJob({
      jobId: job.id,
      tenantId: 'tenant-1',
      reason: 'test',
    });
    expect(finalized?.status).toBe('COMPLETED');
    expect(finalized?.successCount).toBe(1);
  });

  it('protects against duplicate terminal updates (callback + poll)', async () => {
    const store = new InMemoryJobsStore();
    const queue = new InMemoryJobsQueue();
    const { items } = await seedJob(store, ['+79991234567']);
    const item = items[0]!;

    await store.claimItemForSubmit(item.id);
    await store.updateItemAfterSubmit({
      jobItemId: item.id,
      status: 'PENDING',
      providerMessageId: 'msg-1',
      providerCode: 'smsc',
      sentAt: new Date(),
    });

    const provider: JobsProviderPort = {
      submitHlr: vi.fn(),
      submitPing: vi.fn(),
      fetchStatus: vi.fn().mockResolvedValue({
        providerCode: 'smsc',
        providerMessageId: 'msg-1',
        normalized: baseNormalized({
          lifecycleStatus: 'completed',
          resultStatus: 'reachable',
          isReachable: true,
          imsi: '250011234567890',
          extras: { msc: '79001234567' },
        }),
        rawRequest: {},
        rawResponse: {},
        providerRequestId: 'st-enrich',
      } satisfies FetchStatusResult),
    };
    const lifecycle = new JobLifecycleService({ store, queue, provider });

    const first = await lifecycle.applyProviderUpdate({
      jobItemId: item.id,
      tenantId: 'tenant-1',
      normalized: baseNormalized({
        lifecycleStatus: 'completed',
        resultStatus: 'reachable',
        isReachable: true,
      }),
      source: 'callback',
    });
    expect(first.applied).toBe(true);
    expect(first.becameTerminal).toBe(true);
    expect(first.jobItem?.imsi).toBe('250011234567890');
    expect((first.jobItem?.normalizedResult as { extras?: { msc?: string } })?.extras?.msc).toBe(
      '79001234567',
    );

    const second = await lifecycle.applyProviderUpdate({
      jobItemId: item.id,
      tenantId: 'tenant-1',
      normalized: baseNormalized({
        lifecycleStatus: 'completed',
        resultStatus: 'reachable',
        isReachable: true,
        imsi: '250011234567890',
        extras: { msc: '79001234567' },
      }),
      source: 'poll',
    });
    expect(second.duplicate).toBe(true);
    expect(second.applied).toBe(false);

    const fresh = await store.findItemById(item.id);
    expect(fresh?.status).toBe('COMPLETED');
    expect(fresh?.imsi).toBe('250011234567890');
  });

  it('prefers status.php reachability and err over sparse callback on HLR enrich', async () => {
    const store = new InMemoryJobsStore();
    const queue = new InMemoryJobsQueue();
    const { items } = await seedJob(store, ['+79991234567']);
    const item = items[0]!;

    await store.claimItemForSubmit(item.id);
    await store.updateItemAfterSubmit({
      jobItemId: item.id,
      status: 'PENDING',
      providerMessageId: 'msg-1',
      providerCode: 'smsc',
      sentAt: new Date(),
    });

    const fetchStatus = vi.fn().mockResolvedValue({
      providerCode: 'smsc',
      providerMessageId: 'msg-1',
      normalized: baseNormalized({
        lifecycleStatus: 'completed',
        resultStatus: 'reachable',
        isReachable: true,
        providerErrorCode: '0',
        providerStatusCode: '1',
        imsi: '250013000895076',
        mcc: '250',
        mnc: '01',
        operatorName: 'MegaFon',
        extras: { msc: '79261234567' },
      }),
      rawRequest: {},
      rawResponse: {},
      providerRequestId: 'st-reach',
    } satisfies FetchStatusResult);

    const provider: JobsProviderPort = {
      submitHlr: vi.fn(),
      submitPing: vi.fn(),
      fetchStatus,
    };
    const lifecycle = new JobLifecycleService({ store, queue, provider });

    await lifecycle.applyProviderUpdate({
      jobItemId: item.id,
      tenantId: 'tenant-1',
      normalized: baseNormalized({
        lifecycleStatus: 'completed',
        resultStatus: 'unreachable',
        isReachable: false,
        providerErrorCode: '11',
        providerStatusCode: '1',
        // Sparse callback — no imsi/msc, claims unreachable
      }),
      source: 'callback',
    });

    const after = await store.findItemById(item.id);
    expect(after?.isReachable).toBe(true);
    expect(after?.resultStatus).toBe('reachable');
    expect(after?.errorCode).toBe('0');
    expect(after?.imsi).toBe('250013000895076');
  });

  it('keeps unreachable + SMSC err when status.php enrich confirms err≠0', async () => {
    const store = new InMemoryJobsStore();
    const queue = new InMemoryJobsQueue();
    const { items } = await seedJob(store, ['+79991234567']);
    const item = items[0]!;

    await store.claimItemForSubmit(item.id);
    await store.updateItemAfterSubmit({
      jobItemId: item.id,
      status: 'PENDING',
      providerMessageId: 'msg-1',
      providerCode: 'smsc',
      sentAt: new Date(),
    });

    const fetchStatus = vi.fn().mockResolvedValue({
      providerCode: 'smsc',
      providerMessageId: 'msg-1',
      normalized: baseNormalized({
        lifecycleStatus: 'completed',
        resultStatus: 'unreachable',
        isReachable: false,
        providerErrorCode: '11',
        providerStatusCode: '1',
        mcc: '250',
        mnc: '20',
        operatorName: 'T2',
        extras: {},
      }),
      rawRequest: {},
      rawResponse: {},
      providerRequestId: 'st-unreach',
    } satisfies FetchStatusResult);

    const provider: JobsProviderPort = {
      submitHlr: vi.fn(),
      submitPing: vi.fn(),
      fetchStatus,
    };
    const lifecycle = new JobLifecycleService({ store, queue, provider });

    await lifecycle.applyProviderUpdate({
      jobItemId: item.id,
      tenantId: 'tenant-1',
      normalized: baseNormalized({
        lifecycleStatus: 'completed',
        resultStatus: 'unreachable',
        isReachable: false,
        providerErrorCode: '11',
        mcc: '250',
        mnc: '20',
        operatorName: 'T2',
      }),
      source: 'callback',
    });

    const after = await store.findItemById(item.id);
    expect(after?.isReachable).toBe(false);
    expect(after?.resultStatus).toBe('unreachable');
    expect(after?.errorCode).toBe('11');
    expect(fetchStatus).toHaveBeenCalled();
  });

  it('enriches sparse HLR callback via status.php and does not clear fields with null', async () => {
    const store = new InMemoryJobsStore();
    const queue = new InMemoryJobsQueue();
    const { items } = await seedJob(store, ['+79991234567']);
    const item = items[0]!;

    await store.claimItemForSubmit(item.id);
    await store.updateItemAfterSubmit({
      jobItemId: item.id,
      status: 'PENDING',
      providerMessageId: 'msg-1',
      providerCode: 'smsc',
      sentAt: new Date(),
    });

    const fetchStatus = vi.fn().mockResolvedValue({
      providerCode: 'smsc',
      providerMessageId: 'msg-1',
      normalized: baseNormalized({
        lifecycleStatus: 'completed',
        resultStatus: 'reachable',
        isReachable: true,
        imsi: '250013000895076',
        mcc: '250',
        mnc: '01',
        operatorName: 'Mobile TeleSystems (MTS)',
        countryCode: 'Russia',
        roaming: false,
        extras: { msc: '79139400000', region: 'Novosibirsk' },
      }),
      rawRequest: {},
      rawResponse: {},
      providerRequestId: 'st-1',
    } satisfies FetchStatusResult);

    const provider: JobsProviderPort = {
      submitHlr: vi.fn(),
      submitPing: vi.fn(),
      fetchStatus,
    };
    const lifecycle = new JobLifecycleService({ store, queue, provider });

    await lifecycle.applyProviderUpdate({
      jobItemId: item.id,
      tenantId: 'tenant-1',
      normalized: baseNormalized({
        lifecycleStatus: 'completed',
        resultStatus: 'reachable',
        isReachable: true,
        // Sparse callback — no imsi/msc
      }),
      source: 'callback',
    });

    expect(fetchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        providerMessageId: 'msg-1',
        includeDetails: true,
      }),
    );

    const after = await store.findItemById(item.id);
    expect(after?.imsi).toBe('250013000895076');
    expect(after?.operatorName).toBe('Mobile TeleSystems (MTS)');
    expect((after?.normalizedResult as { extras?: { msc?: string } })?.extras?.msc).toBe(
      '79139400000',
    );

    // Sparse poll must not clear enriched fields.
    await lifecycle.applyProviderUpdate({
      jobItemId: item.id,
      tenantId: 'tenant-1',
      normalized: baseNormalized({
        lifecycleStatus: 'completed',
        resultStatus: 'reachable',
        isReachable: true,
        imsi: null,
        extras: {},
      }),
      source: 'poll',
    });
    const kept = await store.findItemById(item.id);
    expect(kept?.imsi).toBe('250013000895076');
    expect((kept?.normalizedResult as { extras?: { msc?: string } })?.extras?.msc).toBe(
      '79139400000',
    );
  });

  it('finalizes stuck PROCESSING job during reconciliation inline', async () => {
    const store = new InMemoryJobsStore();
    const queue = new InMemoryJobsQueue();
    const { job, items } = await seedJob(store, ['+79991111111', '+79992222222']);

    for (const item of items) {
      await store.claimItemForSubmit(item.id);
      await store.transitionItem({
        jobItemId: item.id,
        fromStatuses: ['RESERVED'],
        toStatus: 'COMPLETED',
        patch: {
          resultStatus: 'reachable',
          isReachable: true,
          completedAt: new Date(),
        },
      });
    }
    await store.markJobProcessing(job.id);
    await store.refreshJobCounters(job.id);

    const provider: JobsProviderPort = {
      submitHlr: vi.fn(),
      submitPing: vi.fn(),
      fetchStatus: vi.fn(),
    };
    const lifecycle = new JobLifecycleService({ store, queue, provider });
    const result = await lifecycle.processReconciliation({ limit: 50 });

    expect(result.finalized).toBeGreaterThanOrEqual(1);
    const fresh = await store.findJobById(job.id);
    expect(fresh?.status).toBe('COMPLETED');
  });

  it('dead-letter fails only RESERVED and re-enqueues remaining QUEUED', async () => {
    const store = new InMemoryJobsStore();
    const queue = new InMemoryJobsQueue();
    const { job, items } = await seedJob(store, [
      '+79991234567',
      '+79997654321',
      '+79991112233',
    ]);

    // Simulate: first claimed (RESERVED), others still QUEUED.
    await store.claimItemForSubmit(items[0]!.id);

    const provider: JobsProviderPort = {
      submitHlr: vi.fn(),
      submitPing: vi.fn(),
      fetchStatus: vi.fn(),
    };
    const lifecycle = new JobLifecycleService({ store, queue, provider });
    await lifecycle.markSubmitBatchDeadLetter(
      {
        jobId: job.id,
        tenantId: job.tenantId,
        itemIds: items.map((i) => i.id),
      },
      'attempts exhausted',
    );

    const reserved = await store.findItemById(items[0]!.id);
    expect(reserved?.status).toBe('FAILED');
    expect(reserved?.errorCode).toBe('QUEUE_DEAD_LETTER');

    const stillQueued = await store.findItemById(items[1]!.id);
    expect(stillQueued?.status).toBe('QUEUED');

    expect(queue.of('submit').length).toBeGreaterThan(0);
    const submitMsg = queue.of('submit')[0];
    expect(submitMsg?.payload).toMatchObject({
      jobId: job.id,
      enqueueNonce: expect.stringMatching(/^dlq-/),
    });
    expect(queue.of('finalize')).toHaveLength(1);
  });
});
