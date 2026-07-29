# API outline — Finenumbers

Канон: [plan.md](./plan.md). Публичный контракт подробно: [public-api.md](./public-api.md).  
OpenAPI: `GET /openapi.json`.

---

## Public API `/v1`

Auth: `Authorization: Bearer fnk_live_<prefix>_<secret>`  
Create: header `Idempotency-Key` (рекомендуется)  
Все create — **async** (`202`).

| Method | Path | Назначение |
|--------|------|------------|
| GET | `/v1/me` | tenant + key + limits |
| GET | `/v1/balance` | available / held |
| GET | `/v1/usage` | usage summary (30d) |
| POST | `/v1/checks` | `{ phone, type: "hlr"\|"ping" }` → 202 |
| GET | `/v1/checks/:id` | статус + items/result |
| GET | `/v1/checks` | список (page + filter/sort) |
| POST | `/v1/jobs` | `{ type, phones[] }` → 202 |
| POST | `/v1/jobs/csv` | multipart `file` + `type=hlr\|ping` → 202 (async parse) |
| GET | `/v1/jobs` | список |
| GET | `/v1/jobs/:id` | прогресс |
| GET | `/v1/jobs/:id/items` | элементы |
| GET/POST | `/v1/api-keys` | list / create |
| POST | `/v1/api-keys/:id/rotate` | rotate secret |
| POST | `/v1/api-keys/:id/revoke` | revoke |
| CRUD | `/v1/webhooks` | endpoints |
| POST | `/v1/webhooks/:id/rotate-secret` | rotate signing secret |
| GET | `/v1/webhooks/deliveries` | delivery log |

Ошибки: envelope `{ error: { code, message, details?, requestId } }` — `400`, `401`, `402`, `403`, `404`, `409`, `429`.

---

## Cabinet BFF `/cabinet`

Session auth. UI кабинета: keys, checks, jobs, webhooks, balance. _(не в Stage 7)_

---

## Admin BFF `/admin`

Platform roles. Orgs, users, tariffs, topup, settings, limits, audit, health. _(не в Stage 7)_

---

## Internal

| Method | Path | Назначение |
|--------|------|------------|
| POST/GET | `/internal/smsc/callback` | статусы SMSC (подпись md5/sha1); 401 при невалидной подписи |
| POST | `/admin/provider/smsc/estimate-cost` | live cost HLR/Ping у SMSC (admin; не тариф клиента) |
| GET | `/admin/provider/smsc/balance` | live баланс SMSC (admin) |
| GET | `/health/live` | liveness |
| GET | `/health/ready` | db+redis |
| GET | `/metrics` | Prometheus — E16 |
| GET | `/openapi.json` | OpenAPI document |
| GET | `/docs` | Swagger UI (non-production only; **404 in production**) |
| GET | `/openapi.json` | OpenAPI JSON (non-production only; **404 in production**) |

---

## Webhooks (outbound)

Events: `check.completed`, `check.failed`, `job.completed`  
Header: `X-Finenumbers-Signature: t=<unix>,v1=<hmac_sha256_hex>`  
Envelope: `{ apiVersion: "v1", id, type, createdAt, data }` — dedupe by `id`.  
Retry / timeout: PlatformSettings. Details: [public-api.md](./public-api.md).
