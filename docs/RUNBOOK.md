# Runbook

Short operational playbook. Metrics/alerts: [MONITORING.md](./MONITORING.md). Deploy: [DEPLOYMENT.md](./DEPLOYMENT.md).

## Health checks

| Check | URL / command | Expect |
|-------|---------------|--------|
| API liveness | `GET /health/live` | `{"status":"ok"}` |
| API readiness | `GET /health/ready` | postgres+redis `ok` |
| Worker liveness | `GET worker:9091/health/live` (compose network) | `ok` |
| Metrics | `GET /metrics` (api), `GET :9091/metrics` (worker) | Prometheus text |

Logs are JSON on stdout (`service=api|worker`). Correlate with `requestId` → `jobId` / `jobItemId` → provider `correlationId` → `deliveryId` (see `docs/MONITORING.md` § Logging).

## Common incidents

### API 5xx spike / ApiDown

1. `docker compose logs --tail=200 api`
2. Hit `/health/ready` — if DB/Redis down, fix infra first.
3. Check recent deploy / migration.
4. Roll back image if error is new code; restore DB only if migration corrupted data.

### DatabaseDown / RedisDown

1. `docker compose ps` + healthchecks.
2. Postgres: disk full? `df -h`; logs `docker compose logs postgres`.
3. Redis: AOF rewrite stuck? memory? Compose uses `noeviction` — monitor RAM.
4. Confirm `DATABASE_URL` / `REDIS_URL` inside api/worker containers.

### Queue backlog growing

1. Grafana: **Queue backlog** panel; Prometheus `queue_jobs_waiting`.
2. `docker compose logs --tail=200 worker` — look for `jobs.worker.*.failed`, provider errors.
3. Scale vertically: raise `WORKER_CONCURRENCY` and restart worker.
4. If SMSC throttling/auth: fix credentials / wait; backlog will drain after provider recovers.
5. Dead jobs: inspect BullMQ failed counts (`queue_jobs_failed`).

### Provider error spike / low SMSC balance

1. Confirm `provider_errors_total` and `provider_balance` in Grafana.
2. Validate SMSC login from a scratch container (no secrets in logs).
3. Top up SMSC balance if `LowProviderBalance` fires (threshold 100 — tune in `alerts.yml`).
4. Correlate `jobId` / `jobItemId` in Loki: `{compose_service="worker"} |= "provider"`.

### Webhook delivery failures

1. Metric: `webhook_deliveries_total{status="failed"}`.
2. Loki: `{compose_service="worker"} |= "webhooks.worker"`.
3. Check tenant endpoint URL reachability, TLS, and HMAC secret rotation.
4. Endpoints auto-disable after consecutive failures — re-enable in cabinet after fix.

### Auth brute-force / rate limit pressure

1. Auth zone (per IP): login `AUTH_LOGIN_RPM`, logout `AUTH_LOGOUT_RPM`.
2. Public API zones (per key, separate buckets): `submit` / `read` / `webhook` — see `docs/public-api.md`.
3. Metrics: `rate_limit_hits_total{scope="api_key_submit|api_key_read|api_key_webhook|auth_login"}`.
4. If legitimate traffic: raise PlatformSettings / key RPM for submit; tune `RATE_LIMIT_READ_*` / `RATE_LIMIT_WEBHOOK_*` for other zones.
5. Ensure `TRUST_PROXY=true` or all clients collapse to NPM IP.

### Worker not processing

1. Worker container running? Metrics `up{job="worker"}`.
2. Redis connectivity.
3. Restart worker; jobs are durable in Redis.
4. Check retention/reconciliation repeatable jobs still scheduled after Redis wipe (they re-add on boot).

## Maintenance windows

1. Announce downtime if migrations lock hot tables.
2. Backup Postgres.
3. Stop `api` (reject new work) → drain worker → migrate → start worker → api → web.
4. Verify pilot checklist (below).

## Pilot checklist

1. Login admin / cabinet  
2. Tariff + org + topup + limits  
3. API key create  
4. `POST /v1/checks` → 202 → poll completed  
5. Webhook delivery succeeded  
6. Grafana panels updating; no firing critical alerts  

## Useful commands

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
docker compose logs -f api worker
docker compose exec redis redis-cli ping
docker compose exec postgres pg_isready
```
