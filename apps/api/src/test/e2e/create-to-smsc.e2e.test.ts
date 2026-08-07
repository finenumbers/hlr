/**
 * Nest HTTP E2E: cabinet create → in-memory queue → lifecycle submit → mocked SMSC.
 * Covers the four tariff assignment states.
 */
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  BillingService,
  createBillingJobsHooks,
  isBillingError,
  jobPriceSnapshotFromEstimate,
} from '@finenumbers/billing';
// Resolved by Vitest via package exports; excluded from Nest `tsc` (see tsconfig exclude).
import { FakeBillingPrisma } from '@finenumbers/billing/testing';
import {
  computeProgress,
  CreateJobService,
  InMemoryJobsQueue,
  InMemoryJobsStore,
  JobLifecycleService,
  type JobsProviderPort,
} from '@finenumbers/jobs';
import type { PrismaClient } from '@finenumbers/db';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestContextService } from '../../common/request-context/request-context.service';
import { ApiKeysService } from '../../modules/api-keys/api-keys.service';
import { NestBillingService } from '../../modules/billing/billing.service';
import { CabinetController } from '../../modules/cabinet/cabinet.controller';
import { CsvPreviewService } from '../../modules/cabinet/csv-preview.service';
import { CabinetService } from '../../modules/cabinet/cabinet.service';
import { JobsService } from '../../modules/jobs/jobs.service';
import { WalletsService } from '../../modules/wallets/wallets.service';
import { WebhooksService } from '../../modules/webhooks/webhooks.service';

type State = 'none' | 'hlr-only' | 'ping-only' | 'both';

function seedState(state: State) {
  const db = new FakeBillingPrisma();
  const tenantId = `e2e-${state}`;
  db.seedWallet(tenantId, '100');
  if (state === 'hlr-only' || state === 'both') {
    db.seedAssignedPlan(tenantId, {
      code: 'hlr-e2e',
      sellPrice: '1.500000',
      providerCost: '0.400000',
      checkType: 'HLR',
    });
  }
  if (state === 'ping-only' || state === 'both') {
    db.seedAssignedPlan(tenantId, {
      code: 'ping-e2e',
      sellPrice: '2.500000',
      providerCost: '0.800000',
      checkType: 'PING',
    });
  }
  const billing = new BillingService({ prisma: db as unknown as PrismaClient });
  return { db, billing, tenantId };
}

function mockSubmit(checkType: 'HLR' | 'PING'): JobsProviderPort['submitHlr'] {
  return async (input) => ({
    providerCode: 'smsc',
    checkType,
    providerMessageId: `msg-${checkType.toLowerCase()}`,
    accepted: true,
    deduplicated: false,
    cost: null,
    balance: null,
    normalized: {
      providerCode: 'smsc',
      checkType,
      providerMessageId: `msg-${checkType.toLowerCase()}`,
      phoneE164: input.phoneE164,
      lifecycleStatus: 'accepted',
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
    },
    rawRequest: {},
    rawResponse: {},
    providerRequestId: `req-${checkType.toLowerCase()}`,
  });
}

async function mapBillingError(fn: () => Promise<unknown>) {
  try {
    return await fn();
  } catch (error) {
    if (isBillingError(error)) {
      throw new BadRequestException({
        errorCode: error.code,
        message: error.message,
        details: error.details,
      });
    }
    throw error;
  }
}

async function createCabinetApp(input: {
  tenantId: string;
  billing: BillingService;
  store: InMemoryJobsStore;
  queue: InMemoryJobsQueue;
}): Promise<INestApplication> {
  const nestBilling = {
    assertCanAfford: (args: {
      tenantId: string;
      checkType: 'HLR' | 'PING';
      unitCount: number;
    }) => mapBillingError(() => input.billing.assertCanAfford(args)),
    estimate: (args: {
      tenantId: string;
      checkType: 'HLR' | 'PING';
      unitCount: number;
    }) => mapBillingError(() => input.billing.estimate(args)),
    getJobsHooks: () => createBillingJobsHooks(input.billing),
    quoteProducts: (tenantId: string) => input.billing.quoteProducts(tenantId),
    listLedger: async () => [],
  } as unknown as NestBillingService;

  const createJobService = new CreateJobService({
    store: input.store,
    queue: input.queue,
  });

  const jobsService = {
    create: async (dto: {
      tenantId: string;
      checkType: 'HLR' | 'PING';
      source: 'SINGLE' | 'BULK' | 'API';
      phones: string[];
      createdByUserId?: string;
      idempotencyKey?: string;
      requestId?: string | null;
    }) => {
      const estimate = (await mapBillingError(() =>
        input.billing.assertCanAfford({
          tenantId: dto.tenantId,
          checkType: dto.checkType,
          unitCount: dto.phones.length,
        }),
      )) as Awaited<ReturnType<BillingService['assertCanAfford']>>;

      const result = await createJobService.create({
        tenantId: dto.tenantId,
        checkType: dto.checkType,
        source: dto.source,
        phones: dto.phones,
        idempotencyKey: dto.idempotencyKey,
        createdByUserId: dto.createdByUserId,
        currency: estimate.currency,
        priceSnapshot: jobPriceSnapshotFromEstimate(estimate),
        requestId: dto.requestId,
      });
      return { ...result, progress: computeProgress(result.job) };
    },
  } as unknown as JobsService;

  const moduleRef = await Test.createTestingModule({
    controllers: [CabinetController],
    providers: [
      CabinetService,
      { provide: JobsService, useValue: jobsService },
      { provide: NestBillingService, useValue: nestBilling },
      {
        provide: WalletsService,
        useValue: {
          getByTenantId: async () => ({
            availableBalance: '100',
            heldBalance: '0',
            currency: 'RUB',
          }),
        },
      },
      { provide: ApiKeysService, useValue: {} },
      { provide: WebhooksService, useValue: {} },
      { provide: RequestContextService, useValue: { requestId: 'e2e-req' } },
      { provide: PrismaService, useValue: {} },
      { provide: CsvPreviewService, useValue: {} },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = {
      userId: 'user-e2e',
      email: 'e2e@example.com',
      platformRole: null,
      membershipRole: 'OWNER',
      tenantId: input.tenantId,
    };
    next();
  });
  await app.init();
  return app;
}

describe('Nest HTTP E2E create → SMSC', () => {
  const apps: INestApplication[] = [];

  afterEach(async () => {
    while (apps.length) {
      await apps.pop()!.close();
    }
  });

  it.each([
    { state: 'none' as const, checkType: 'HLR' as const, expectSmsc: false },
    { state: 'hlr-only' as const, checkType: 'HLR' as const, expectSmsc: true },
    { state: 'hlr-only' as const, checkType: 'PING' as const, expectSmsc: false },
    { state: 'ping-only' as const, checkType: 'PING' as const, expectSmsc: true },
    { state: 'ping-only' as const, checkType: 'HLR' as const, expectSmsc: false },
    { state: 'both' as const, checkType: 'HLR' as const, expectSmsc: true },
    { state: 'both' as const, checkType: 'PING' as const, expectSmsc: true },
  ])(
    'state=$state checkType=$checkType → SMSC=$expectSmsc',
    async ({ state, checkType, expectSmsc }) => {
      const { db, billing, tenantId } = seedState(state);
      const store = new InMemoryJobsStore();
      const queue = new InMemoryJobsQueue();
      const submitHlr = vi.fn(mockSubmit('HLR'));
      const submitPing = vi.fn(mockSubmit('PING'));
      const provider: JobsProviderPort = {
        submitHlr,
        submitPing,
        fetchStatus: vi.fn(),
      };

      const app = await createCabinetApp({ tenantId, billing, store, queue });
      apps.push(app);

      const res = await request(app.getHttpServer())
        .post('/cabinet/checks')
        .set('X-Tenant-Id', tenantId)
        .send({ checkType, phones: ['+79991234567'] });

      if (!expectSmsc) {
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(String(res.body.message ?? res.body.errorCode ?? '')).toMatch(
          /TARIFF|tariff|not configured/i,
        );
        expect(queue.of('submit')).toHaveLength(0);
        expect(submitHlr).not.toHaveBeenCalled();
        expect(submitPing).not.toHaveBeenCalled();
        return;
      }

      expect(res.status).toBeLessThan(300);
      const jobId = res.body.job?.id ?? res.body.id;
      expect(jobId).toBeTruthy();

      const submitMsgs = queue.of('submit');
      expect(submitMsgs).toHaveLength(1);
      const payload = submitMsgs[0]!.payload as {
        jobId: string;
        tenantId: string;
        itemIds: string[];
      };

      for (const item of await store.listItemsByIds(payload.itemIds)) {
        db.importJobItem(item);
      }

      const lifecycle = new JobLifecycleService({
        store,
        queue,
        provider,
        billing: createBillingJobsHooks(billing),
      });
      await lifecycle.processSubmitBatch(payload);

      if (checkType === 'HLR') {
        expect(submitHlr).toHaveBeenCalledTimes(1);
        expect(submitPing).not.toHaveBeenCalled();
      } else {
        expect(submitPing).toHaveBeenCalledTimes(1);
        expect(submitHlr).not.toHaveBeenCalled();
      }
      expect(db.transactions.some((t: { type: string }) => t.type === 'HOLD')).toBe(true);
    },
  );
});
