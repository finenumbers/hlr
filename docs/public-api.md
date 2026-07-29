# Public API & Webhooks

Production client API for Finenumbers HLR / Ping-SMS.  
OpenAPI / Swagger UI: **non-production only** (`GET /openapi.json`, `GET /docs`). Both return **404 in production** (not overridable).

---

## Auth

All `/v1/*` routes require an API key:

```http
Authorization: Bearer fnk_live_<prefix>_<secret>
```

- Session/cookie auth is **not** used on the public API.
- Keys are stored only as `HMAC-SHA256(API_KEY_PEPPER, secret)`; plaintext is shown **once** on create/rotate.
- Revoked or expired keys return `401` with `API_KEY_REVOKED` / `API_KEY_EXPIRED`.
- Rate limits are **zone-separated** per API key (independent Redis buckets):

| Zone | Applies to | RPM |
|------|------------|-----|
| `submit` | `POST /v1/checks`, `POST /v1/jobs` | key → tenant → platform `rateLimitRpm` |
| `read` | GET polling / lists / me / balance / usage | `submit × RATE_LIMIT_READ_MULTIPLIER` (cap `RATE_LIMIT_READ_RPM_MAX`) |
| `webhook` | `/v1/webhooks*`, API-key create/rotate/revoke | `min(submit, RATE_LIMIT_WEBHOOK_RPM, submit×multiplier)` |
| `auth` | `POST /auth/login`, `POST /auth/logout` | per-IP (`AUTH_LOGIN_RPM` / `AUTH_LOGOUT_RPM`) |

Response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Zone`, `Retry-After` on 429.

Payload size: default `BODY_LIMIT` (256kb); submit routes `BODY_LIMIT_SUBMIT` (1mb). List responses capped at `pageSize ≤ 100`.

### Key lifecycle

| Action | Endpoint |
|--------|----------|
| List (masked) | `GET /v1/api-keys` |
| Create | `POST /v1/api-keys` → `{ secret, masked, ... }` once |
| Rotate | `POST /v1/api-keys/:id/rotate` → new `secret` once |
| Revoke | `POST /v1/api-keys/:id/revoke` |

Store `secret` immediately; it cannot be retrieved again.

---

## Endpoints

| Method | Path | Notes |
|--------|------|-------|
| GET | `/v1/me` | Tenant + key + limits |
| GET | `/v1/balance` | `availableBalance`, `heldBalance` |
| GET | `/v1/usage` | 30-day usage summary |
| POST | `/v1/checks` | Single HLR/Ping → **202** |
| GET | `/v1/checks` | List jobs |
| GET | `/v1/checks/:id` | Job or item id + items/results |
| POST | `/v1/jobs` | Bulk phones[] → **202** |
| GET | `/v1/jobs` | List + filter/sort |
| GET | `/v1/jobs/:id` | Job status |
| GET | `/v1/jobs/:id/items` | Paginated results |
| CRUD | `/v1/webhooks` | Endpoint config |
| GET | `/v1/webhooks/deliveries` | Delivery log / dead-letter |

Creates are **async only** (no sync wait for provider).

### Submit example

```http
POST /v1/checks
Authorization: Bearer fnk_live_...
Idempotency-Key: order-123-check-1
Content-Type: application/json

{ "phone": "+79991234567", "type": "hlr" }
```

```json
{
  "id": "clxxxxxxxx",
  "checkType": "HLR",
  "status": "QUEUED",
  "itemCount": 1,
  "successCount": 0,
  "failureCount": 0,
  "estimatedCost": null,
  "actualCost": null,
  "currency": "RUB",
  "createdAt": "2026-07-29T00:00:00.000Z",
  "progress": { "total": 1, "processed": 0, "success": 0, "failed": 0, "pending": 1 }
}
```

Poll `GET /v1/checks/{id}` until items are terminal, or use webhooks.

---

## Idempotency

Recommended on `POST /v1/checks` and `POST /v1/jobs`:

```http
Idempotency-Key: <client-unique-string>
```

- Same key + same body → cached **202** response replayed.
- Same key + different body → `409 IDEMPOTENCY_KEY_REUSE`.
- Also stored on the Job (`tenantId + idempotencyKey`) for create dedupe.

---

## Errors

All error responses use one envelope (never Nest/default shapes):

```json
{
  "error": {
    "code": "INSUFFICIENT_FUNDS",
    "message": "Insufficient available balance for this request",
    "requestId": "9f3c2a1b-4d5e-6789-abcd-ef0123456789",
    "details": {}
  }
}
```

| Field | Required | Use |
|-------|----------|-----|
| `error.code` | yes | Machine-readable; switch/automation key |
| `error.message` | yes | Human-readable |
| `error.requestId` | yes | Correlate with logs / support (`X-Request-Id` header mirrors it) |
| `error.details` | no | Structured extras (e.g. validation field list) |

Common codes: `VALIDATION_FAILED`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `IDEMPOTENCY_KEY_REUSE`, `INSUFFICIENT_FUNDS` (402), `RATE_LIMITED` (429), `API_KEY_REVOKED`, `API_KEY_EXPIRED`, `TARIFF_NOT_CONFIGURED`.

---

## Webhooks

### Events

| Event | When |
|-------|------|
| `check.completed` | Job item completed |
| `check.failed` | Job item failed |
| `job.completed` | Job finalized (`COMPLETED`, `COMPLETED_WITH_ERRORS`, or `FAILED`) |

Empty `events[]` on an endpoint = subscribe to **all**.

### Delivery

- Async via BullMQ (`webhooks-deliver`); HTTP create path is never blocked.
- **At-least-once** — clients must dedupe by envelope `id` (delivery id).
- Retries with exponential backoff (`PlatformSettings.webhookMaxAttempts`, timeout `webhookTimeoutMs`).
- After many consecutive failures the endpoint is auto-disabled; re-enable via `PATCH /v1/webhooks/:id`.
- Failed / dead deliveries are visible at `GET /v1/webhooks/deliveries`.

### Payload (v1)

```json
{
  "apiVersion": "v1",
  "id": "delivery_cuid",
  "type": "check.completed",
  "createdAt": "2026-07-29T12:00:00.000Z",
  "data": {
    "jobId": "…",
    "jobItemId": "…",
    "checkType": "HLR",
    "status": "COMPLETED",
    "phoneE164": "+79991234567",
    "resultStatus": "reachable",
    "isReachable": true
  }
}
```

Provider raw payloads are **not** included.

### Headers

| Header | Value |
|--------|--------|
| `X-Finenumbers-Signature` | `t=<unix>,v1=<hmac_hex>` |
| `X-Finenumbers-Delivery-Id` | delivery id |
| `X-Finenumbers-Event` | event type |

### Signature verification

```
signed_payload = `${t}.${rawBody}`
expected = HMAC_SHA256(endpoint_secret, signed_payload) // hex
```

1. Parse `t` and `v1` from `X-Finenumbers-Signature`.
2. Reject if `|now - t| > 300` seconds (recommended).
3. Compute HMAC over the **raw** request body (not re-serialized JSON).
4. Compare with `timingSafeEqual`.

Node example:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(secret, rawBody, header, toleranceSec = 300) {
  const parts = Object.fromEntries(
    header.split(',').map((p) => p.trim().split('=')),
  );
  const t = Number(parts.t);
  const sig = parts.v1;
  if (!t || !sig) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret)
    .update(`${t}.${rawBody}`, 'utf8')
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

Signing secret is returned once on `POST /v1/webhooks` or `POST /v1/webhooks/:id/rotate-secret`.

---

## Tenant isolation

Every `/v1` query is scoped to the API key’s `tenantId`. Cross-tenant ids return `404`.
