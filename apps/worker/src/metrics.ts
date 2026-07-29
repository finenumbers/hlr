import http from 'node:http';

import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';
import type { Queue } from 'bullmq';
import type IORedis from 'ioredis';

import { workerLogger } from './logger';

export type WorkerMetrics = {
  registry: Registry;
  jobsProcessedTotal: Counter<string>;
  jobDurationSeconds: Histogram<string>;
  providerErrorsTotal: Counter<string>;
  webhookDeliveriesTotal: Counter<string>;
  queueWaiting: Gauge<string>;
  queueActive: Gauge<string>;
  queueFailed: Gauge<string>;
  providerBalance: Gauge<string>;
  dbUp: Gauge<string>;
  redisUp: Gauge<string>;
  startServer: (port: number) => http.Server;
  refreshQueues: (queues: Queue[]) => Promise<void>;
  close: () => Promise<void>;
};

export function createWorkerMetrics(input: {
  env: string;
  enabled: boolean;
}): WorkerMetrics {
  const registry = new Registry();
  registry.setDefaultLabels({ service: 'worker', env: input.env });

  if (input.enabled) {
    collectDefaultMetrics({ register: registry });
  }

  const jobsProcessedTotal = new Counter({
    name: 'worker_jobs_processed_total',
    help: 'BullMQ jobs finished (completed handler or failed handler)',
    labelNames: ['queue', 'status'],
    registers: [registry],
  });

  const jobDurationSeconds = new Histogram({
    name: 'worker_job_duration_seconds',
    help: 'Wall-clock duration of a worker job handler',
    labelNames: ['queue', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15, 30, 60, 120],
    registers: [registry],
  });

  const providerErrorsTotal = new Counter({
    name: 'provider_errors_total',
    help: 'Provider/SMSC failures (thrown ProviderError or failed submit/poll items)',
    labelNames: ['provider', 'kind', 'stage'],
    registers: [registry],
  });

  const webhookDeliveriesTotal = new Counter({
    name: 'webhook_deliveries_total',
    help: 'Outbound webhook delivery outcomes from delivery service (not BullMQ alone)',
    labelNames: ['status'],
    registers: [registry],
  });

  const queueWaiting = new Gauge({
    name: 'queue_jobs_waiting',
    help: 'Jobs waiting + delayed in BullMQ queue (backlog)',
    labelNames: ['queue'],
    registers: [registry],
  });

  const queueActive = new Gauge({
    name: 'queue_jobs_active',
    help: 'Jobs active in BullMQ queue',
    labelNames: ['queue'],
    registers: [registry],
  });

  const queueFailed = new Gauge({
    name: 'queue_jobs_failed',
    help: 'Failed jobs retained in BullMQ queue',
    labelNames: ['queue'],
    registers: [registry],
  });

  const providerBalance = new Gauge({
    name: 'provider_balance',
    help: 'Latest known provider account balance',
    labelNames: ['provider', 'currency'],
    registers: [registry],
  });

  const dbUp = new Gauge({
    name: 'app_db_up',
    help: '1 if Postgres responds',
    registers: [registry],
  });

  const redisUp = new Gauge({
    name: 'app_redis_up',
    help: '1 if Redis responds',
    registers: [registry],
  });

  let server: http.Server | undefined;

  return {
    registry,
    jobsProcessedTotal,
    jobDurationSeconds,
    providerErrorsTotal,
    webhookDeliveriesTotal,
    queueWaiting,
    queueActive,
    queueFailed,
    providerBalance,
    dbUp,
    redisUp,
    startServer(port: number) {
      server = http.createServer(async (req, res) => {
        if (req.url === '/health/live') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', service: 'worker' }));
          return;
        }
        if (req.url === '/metrics') {
          if (!input.enabled) {
            res.writeHead(503).end('metrics disabled');
            return;
          }
          res.writeHead(200, {
            'Content-Type': registry.contentType,
          });
          res.end(await registry.metrics());
          return;
        }
        res.writeHead(404).end();
      });
      server.listen(port, '0.0.0.0', () => {
        workerLogger.info('jobs.worker.metrics_listen', { port });
      });
      return server;
    },
    async refreshQueues(queues: Queue[]) {
      for (const queue of queues) {
        const counts = await queue.getJobCounts(
          'waiting',
          'active',
          'failed',
          'delayed',
        );
        queueWaiting.set(
          { queue: queue.name },
          (counts.waiting ?? 0) + (counts.delayed ?? 0),
        );
        queueActive.set({ queue: queue.name }, counts.active ?? 0);
        queueFailed.set({ queue: queue.name }, counts.failed ?? 0);
      }
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        if (!server) {
          resolve();
          return;
        }
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

export async function probeRedis(
  metrics: WorkerMetrics,
  connection: IORedis,
): Promise<void> {
  try {
    const pong = await connection.ping();
    metrics.redisUp.set(pong === 'PONG' ? 1 : 0);
  } catch {
    metrics.redisUp.set(0);
  }
}

/** Record one finished job: count + latency. */
export function observeWorkerJob(
  metrics: WorkerMetrics | undefined,
  input: {
    queue: string;
    status: 'completed' | 'failed';
    started: bigint;
  },
): void {
  if (!metrics) {
    return;
  }
  const durationSeconds = Number(process.hrtime.bigint() - input.started) / 1e9;
  metrics.jobsProcessedTotal.inc({
    queue: input.queue,
    status: input.status,
  });
  metrics.jobDurationSeconds.observe(
    { queue: input.queue, status: input.status },
    durationSeconds,
  );
}
