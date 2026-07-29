import { BillingService, createBillingJobsHooks } from '@finenumbers/billing';
import { loadWorkerEnv } from '@finenumbers/config';
import { createPrismaClient } from '@finenumbers/db';
import {
  JobLifecycleService,
  PrismaJobsStore,
  QUEUE_JOB_NAMES,
  QUEUE_NAMES,
  RECONCILIATION_INTERVAL_MS,
  RETENTION_INTERVAL_MS,
  type JobsProviderPort,
} from '@finenumbers/jobs';
import { ProviderError } from '@finenumbers/provider-core';
import { resolveSmscConfig, SmscProvider } from '@finenumbers/provider-smsc';
import {
  createJobsWebhookHooks,
  WEBHOOK_QUEUE_NAMES,
  WebhookDeliveryService,
} from '@finenumbers/webhooks';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { workerLogger } from './logger';
import { createWorkerMetrics, probeRedis } from './metrics';
import { createJobsWorkers } from './processors';
import { PrismaProviderPersistence } from './prisma-provider-persistence';
import { WorkerQueuePublisher } from './queue-publisher';
import { runRetentionSweep } from './retention';
import { createWebhookWorker } from './webhook-processor';
import { WorkerWebhookQueuePublisher } from './webhook-queue-publisher';

function createUnavailableProvider(): JobsProviderPort {
  const fail = async (): Promise<never> => {
    throw new ProviderError({
      providerCode: 'smsc',
      kind: 'auth',
      message: 'SMSC credentials are not configured on the worker',
      retryable: false,
    });
  };
  return {
    submitHlr: fail,
    submitPing: fail,
    fetchStatus: fail,
  };
}

async function bootstrap(): Promise<void> {
  const env = loadWorkerEnv();
  const prisma = createPrismaClient();
  await prisma.$connect();

  const connection = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });

  const metrics = createWorkerMetrics({
    env: env.NODE_ENV,
    enabled: env.METRICS_ENABLED,
  });
  if (env.METRICS_ENABLED) {
    metrics.startServer(env.WORKER_METRICS_PORT);
  }

  const queue = new WorkerQueuePublisher(connection);
  const store = new PrismaJobsStore(prisma);
  const persistence = new PrismaProviderPersistence(prisma);

  const billingService = new BillingService({
    prisma,
    logger: workerLogger,
    audit: async (input) => {
      await prisma.auditLog.create({
        data: {
          tenantId: input.tenantId ?? null,
          actorType: input.actorType,
          actorUserId: input.actorUserId ?? null,
          action: input.action,
          targetType: input.targetType ?? null,
          targetId: input.targetId ?? null,
          metadata: input.metadata,
        },
      });
    },
  });
  const billingHooks = createBillingJobsHooks(billingService, workerLogger);

  const webhookQueue = new WorkerWebhookQueuePublisher(connection);
  const webhookDelivery = new WebhookDeliveryService({
    prisma,
    queue: webhookQueue,
    logger: workerLogger,
  });
  const webhookHooks = createJobsWebhookHooks(webhookDelivery, prisma, workerLogger);

  let provider: JobsProviderPort;
  let smscProvider: SmscProvider | undefined;
  try {
    const smscConfig = resolveSmscConfig({
      baseUrl: env.SMSC_BASE_URL,
      login: env.SMSC_LOGIN,
      password: env.SMSC_PASSWORD,
      apiKey: env.SMSC_API_KEY,
      currency: env.SMSC_CURRENCY,
      timeoutMs: env.SMSC_TIMEOUT_MS,
      retryMaxAttempts: env.SMSC_RETRY_MAX,
      retryBaseDelayMs: env.SMSC_RETRY_BASE_DELAY_MS,
      callbackSecret: env.SMSC_CALLBACK_SECRET,
    });
    smscProvider = new SmscProvider({
      config: smscConfig,
      persistence,
      logger: workerLogger,
    });
    provider = smscProvider;
  } catch (error) {
    workerLogger.warn('jobs.worker.smsc_config_incomplete', {
      message: error instanceof Error ? error.message : String(error),
    });
    provider = createUnavailableProvider();
  }

  const lifecycle = new JobLifecycleService({
    store,
    queue,
    provider,
    billing: billingHooks,
    webhooks: webhookHooks,
    logger: workerLogger,
  });

  const workers = createJobsWorkers({
    connection,
    concurrency: env.WORKER_CONCURRENCY,
    lifecycle,
    metrics,
    onRetention: () => runRetentionSweep(prisma),
  });
  const webhookWorker = createWebhookWorker({
    connection,
    concurrency: env.WORKER_CONCURRENCY,
    delivery: webhookDelivery,
    metrics,
  });

  const reconciliationQueue = new Queue(QUEUE_NAMES.JOBS_RECONCILIATION, {
    connection,
  });
  await reconciliationQueue.add(
    QUEUE_JOB_NAMES.RECONCILE_STALE,
    { limit: 100 },
    {
      repeat: { every: RECONCILIATION_INTERVAL_MS },
      jobId: 'reconcile-stale-tick',
    },
  );

  const retentionQueue = new Queue(QUEUE_NAMES.JOBS_RETENTION, { connection });
  await retentionQueue.add(
    QUEUE_JOB_NAMES.RETENTION_SWEEP,
    {},
    {
      repeat: { every: RETENTION_INTERVAL_MS },
      jobId: 'retention-sweep-tick',
    },
  );

  const metricQueues = [
    new Queue(QUEUE_NAMES.JOBS_SUBMIT, { connection }),
    new Queue(QUEUE_NAMES.JOBS_STATUS_POLL, { connection }),
    new Queue(QUEUE_NAMES.JOBS_FINALIZE, { connection }),
    new Queue(QUEUE_NAMES.JOBS_RECONCILIATION, { connection }),
    new Queue(QUEUE_NAMES.JOBS_RETENTION, { connection }),
    new Queue(WEBHOOK_QUEUE_NAMES.WEBHOOKS_DELIVER, { connection }),
  ];

  const queueMetricsTimer = setInterval(() => {
    void (async () => {
      try {
        await metrics.refreshQueues(metricQueues);
        await probeRedis(metrics, connection);
        try {
          await prisma.$queryRaw`SELECT 1`;
          metrics.dbUp.set(1);
        } catch {
          metrics.dbUp.set(0);
        }
      } catch (error) {
        workerLogger.warn('jobs.worker.queue_metrics_failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }, env.QUEUE_METRICS_INTERVAL_MS);
  queueMetricsTimer.unref?.();

  let balanceTimer: ReturnType<typeof setInterval> | undefined;
  if (smscProvider && env.PROVIDER_BALANCE_POLL_MS > 0) {
    const pollBalance = async (): Promise<void> => {
      try {
        const balance = await smscProvider!.getBalance('metrics');
        const numeric = Number.parseFloat(balance.balance);
        if (Number.isFinite(numeric)) {
          metrics.providerBalance.set(
            {
              provider: 'smsc',
              currency: balance.currency ?? env.SMSC_CURRENCY,
            },
            numeric,
          );
        }
      } catch (error) {
        metrics.providerErrorsTotal.inc({
          provider: 'smsc',
          kind: 'balance',
          stage: 'balance',
        });
        workerLogger.warn('jobs.worker.provider_balance_failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };
    void pollBalance();
    balanceTimer = setInterval(() => void pollBalance(), env.PROVIDER_BALANCE_POLL_MS);
    balanceTimer.unref?.();
  }

  workerLogger.info('jobs.worker.bootstrap', {
    concurrency: env.WORKER_CONCURRENCY,
    queues: [...Object.values(QUEUE_NAMES), WEBHOOK_QUEUE_NAMES.WEBHOOKS_DELIVER],
    billing: 'enabled',
    webhooks: 'enabled',
    metricsPort: env.METRICS_ENABLED ? env.WORKER_METRICS_PORT : null,
  });

  const shutdown = async (signal: string): Promise<void> => {
    workerLogger.info('jobs.worker.shutdown', { signal });
    clearInterval(queueMetricsTimer);
    if (balanceTimer) {
      clearInterval(balanceTimer);
    }
    await Promise.all([
      workers.submit.close(),
      workers.poll.close(),
      workers.finalize.close(),
      workers.reconciliation.close(),
      workers.retention.close(),
      webhookWorker.close(),
    ]);
    await Promise.all(metricQueues.map((q) => q.close()));
    await reconciliationQueue.close();
    await retentionQueue.close();
    await queue.close();
    await webhookQueue.close();
    await metrics.close();
    await connection.quit();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void bootstrap().catch((error: unknown) => {
  console.error('[worker] fatal bootstrap error', error);
  process.exit(1);
});
