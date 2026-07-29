# Monitoring

Stack: Prometheus + Grafana + Loki (+ Promtail). App exporters: Nest `/metrics`, worker `:9091/metrics`.

## Bring-up

```bash
docker compose -f docker-compose.yml -f docker-compose.obs.yml up -d
# with prod binds:
docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.obs.yml up -d
```

| UI | Default |
|----|---------|
| Grafana | `http://localhost:3002` (`GRAFANA_ADMIN_*`) |
| Prometheus | `http://localhost:9090` |
| Loki | `http://localhost:3100` |

Dashboard: **Finenumbers Overview** — one panel group per SLI below.

## Core SLIs (what to watch)

| Need | Metric / recording rule | Notes |
|------|-------------------------|--------|
| **Latency** | `http_request_duration_seconds_*`, `job:http_request_duration_seconds:p95`, `worker_job_duration_seconds_*` | API histogram + worker job wall time |
| **Error rate** | `http_requests_total{status_class="5xx"}`, `job:http_error_rate:ratio_rate5m` | 5xx / all requests |
| **Queue backlog** | `queue_jobs_waiting{queue}`, `job:queue_backlog:sum` | waiting + delayed per BullMQ queue |
| **Worker failures** | `worker_jobs_processed_total{status="failed"}`, `job:worker_failure_rate:rate5m` | handler failures (after retries exhausted / thrown) |
| **Webhook failures** | `webhook_deliveries_total{status=~"failed\|dead"}`, `job:webhook_failure_rate:rate5m` | from delivery **result**, not BullMQ alone |
| **Provider errors** | `provider_errors_total{provider,kind,stage}`, `job:provider_error_rate:rate5m` | submit item failures + thrown `ProviderError` + poll FAILED |

Recording rules: `infra/monitoring/prometheus/recording-rules.yml`.

## Metrics catalog

### API (`service=api`)

| Metric | Meaning |
|--------|---------|
| `http_requests_total{method,route,status_code,status_class}` | Request count (`status_class` = 2xx/4xx/5xx) |
| `http_request_duration_seconds_*` | Latency histogram |
| `rate_limit_hits_total{scope}` | Zone denials |
| `app_db_up` / `app_redis_up` | Dependency probes |

Routes are low-cardinality (`:id` collapsed).

### Worker (`service=worker`)

| Metric | Meaning |
|--------|---------|
| `queue_jobs_waiting{queue}` | Backlog (waiting + delayed) |
| `queue_jobs_active{queue}` / `queue_jobs_failed{queue}` | In-flight / retained failed |
| `worker_jobs_processed_total{queue,status}` | Job outcomes |
| `worker_job_duration_seconds_*` | Handler latency |
| `provider_errors_total{provider,kind,stage}` | SMSC/provider failures |
| `webhook_deliveries_total{status}` | `succeeded` / `failed` / `dead` |
| `provider_balance{provider,currency}` | SMSC balance gauge |

**Important:** webhook delivery returns `FAILED`/`DEAD` without throwing. Metrics read the delivery result so failures are not counted as success.

## Alerts

Rules: `infra/monitoring/prometheus/alerts.yml`.

| Alert | Signal |
|-------|--------|
| `HighHttpLatencyP95` | p95 > 2s |
| `HighHttp5xxRate` | 5xx ratio > 5% |
| `QueueBacklogGrowing` | backlog >200 and rising |
| `WorkerJobFailureSpike` | failed job rate |
| `ProviderErrorSpike` | provider error rate |
| `WebhookDeliveryFailures` | failed+dead rate |
| `ApiDown` / `WorkerDown` / `DatabaseDown` / `RedisDown` | availability |
| `LowProviderBalance` | SMSC balance threshold |

## Logging

JSON stdout (`service=api|worker`). Phones masked; secrets redacted (`fnk_*`, `whsec_*`, Bearer/Basic, password/token keys). Promtail → Loki for `api`/`worker`.

### Correlation chain

| Stage | Typical log msg | Key fields |
| --- | --- | --- |
| Request | `http_request` / `http_error` | `requestId`, `method`, `path`, `status`/`code` |
| Job create | `jobs.create.enqueued` | `requestId`, `jobId`, `tenantId` |
| Worker submit | `jobs.worker.submit.start` → `jobs.submit.batch_done` / `jobs.submit.item_failed` | `requestId`, `jobId`, `jobItemId` |
| Provider | `smsc.http.request` / `smsc.http.response` | `correlationId` (= `jobItemId`), no raw `psw`/phones |
| Worker poll | `jobs.worker.poll.start` → `jobs.poll.*` | `requestId`, `jobItemId`, `jobId` |
| Webhook | `webhooks.enqueue.created` → `webhooks.worker.deliver.*` → `webhooks.deliver.succeeded\|failed` | `deliveryId`, `jobItemId`, `tenantId` |
| Error | `http_error`, `*.failed`, `jobs.submit.item_failed` | `code`/`message`, correlators above |

Trace: start with client `X-Request-Id` / error `requestId` → filter Loki by `requestId` → follow `jobId` / `jobItemId` → `correlationId` on SMSC → `deliveryId` for webhooks.
