# Architecture — Finenumbers HLR Lookup Service

Черновик-каркас. Детали дополняются по мере этапов E01+.  
Канон решений: [plan.md](./plan.md).

---

## Apps

| App | Роль |
|-----|------|
| `apps/api` | HTTP: public `/v1`, cabinet BFF, admin BFF, SMSC callback |
| `apps/worker` | BullMQ: send, poll, csv-parse, webhook-deliver |
| `apps/web` | Кабинет (`/app`) + админка (`/admin`) на одном Next.js, RU/EN |

## Packages

| Package | Роль |
|---------|------|
| `packages/db` | Prisma schema + client (`@finenumbers/db`) |
| `packages/billing` | ledger, tariffs, jobs billing hooks |
| `packages/jobs` | job lifecycle, stores, queues |
| `packages/webhooks` | delivery signing / ports |
| `packages/contracts` | shared health DTOs |
| `packages/provider-core` | порт провайдера |
| `packages/provider-smsc` | SMSC HTTP + normalizer |
| `packages/config` | env secrets/infra |

## Очереди (BullMQ / Redis)

- `jobs-submit` — fan-out provider submit (batches of JobItems)  
- `jobs-status-poll` — fallback status when callback is late/missing  
- `jobs-finalize` — close Job when all items terminal  
- `jobs-reconciliation` — re-queue stale PENDING + finalize stuck jobs  
- `jobs-csv-parse` — stream-parse uploaded CSV → fan-out submit  
- `webhooks.deliver` (E13)  

Orchestration package: `@finenumbers/jobs` (see package README).  


## Сетевой контур (prod)

```
Internet → NPM (TLS) → web | api
worker — только внутренняя сеть + Redis/Postgres + SMSC egress
```

NPM **вне** compose-проекта. Подробности: [operations.md](./operations.md).

## Модули api (целевые)

`auth`, `tenants`, `api-keys`, `settings`, `tariffs`, `billing`, `jobs`, `provider-smsc`, `smsc-callback`, `webhooks`, `audit`, `cabinet`, `admin-panel`, `public-api`, `health`, `metrics`.

## Безопасность (кратко)

- Tenant isolation по `tenantId`  
- API keys hashed  
- SMSC secrets только env  
- Raw provider payload не в клиентский UI (MVP)  

## Фактические порты / сервисы (после Stage 1 scaffold)

| Service | Compose name | Default host port |
|---------|--------------|-------------------|
| API | `api` | `3001` |
| Web | `web` | `3000` |
| Worker | `worker` | — |
| Postgres | `postgres` | `5432` |
| Redis | `redis` | `6379` |
| Prometheus | `prometheus` | `9090` |
| Grafana | `grafana` | `3002` |
| Loki | `loki` | `3100` |

Health: `GET /health/live`, `GET /health/ready` на api.

Структура: `apps/{api,worker,web}`, `packages/{db,billing,config,contracts,tsconfig,provider-core,provider-smsc,jobs,webhooks}`, `infra/{docker,monitoring}`.

### Billing ledger (E07)

- `packages/billing` — ledger-first `BillingService` (HOLD/DEBIT/RELEASE/CREDIT/ADJUSTMENT), tariff resolver, jobs hooks
- Nest `BillingModule` — topup/adjust/estimate API; wires `BillingWorkflowPort`
- Worker uses `createBillingJobsHooks` (reserve before submit, capture/release on terminal)
- Sell price vs provider cost are separate fields; client charges use sell price only

### Provider adapter (E08)

- `packages/provider-core` — `NumberLookupProvider`, `NormalizedResult`, persistence port  
- `packages/provider-smsc` — SMSC HTTP (`fmt=3`), mapper, timeout/retry, README  
- Nest `ProviderSmscModule` — DI + Prisma hooks для `provider_requests` / `provider_callbacks`  
- Секреты только `SMSC_*` из env (`@finenumbers/config`); биллинг/jobs — вне адаптера

## TODO дописать после реализации

- [x] Фактические порты и имена docker-сервисов  
- [ ] Диаграмма последовательности check (mermaid)  
- [ ] Выбор session vs JWT — зафиксировать  
