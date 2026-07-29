# `@finenumbers/provider-smsc`

Production adapter for [SMSC.ru](https://smsc.ru) HTTP API (HLR + Ping-SMS).  
Implements `@finenumbers/provider-core` `NumberLookupProvider`.

## Flow

```text
App / Worker
   │  (only via NumberLookupProvider / Nest PROVIDER_SMSC)
   ▼
SmscProvider
   ├── estimateHlrCost / estimatePingCost  → send.php?cost=1&hlr|ping=1&fmt=3
   ├── submitHlr / submitPing              → send.php?hlr|ping=1&fmt=3&id=<clientId>
   ├── fetchStatus                         → status.php?all=2&fmt=3
   ├── handleProviderCallback              → verify signature → normalize
   └── mapProviderResponse / mapProviderStatus  (shared pipeline)
         │
         ├── SmscHttpClient (timeout + transient retry + redacted logs)
         └── ProviderPersistencePort (provider_requests / provider_callbacks)
```

Callback and status polling share `mapProviderResponse()` so both produce the same `NormalizedResult`.

## Supported methods

| Method | SMSC endpoint | Notes |
|--------|---------------|--------|
| `estimateHlrCost` / `estimatePingCost` | `POST /sys/send.php` | `cost=1`, no send |
| `submitHlr` / `submitPing` | `POST /sys/send.php` | `hlr=1` or `ping=1` |
| `fetchStatus` | `POST /sys/status.php` | `all=2` for HLR extras |
| `handleProviderCallback` | inbound payload | optional md5/sha1 verify |
| `getBalance` | `POST /sys/balance.php` | admin/health |
| `mapProviderResponse` / `mapProviderStatus` | local | pure mapping |

## Assumptions (conservative)

1. **JSON only** (`fmt=3`). Non-JSON bodies are kept as `{ _nonJson, text }` and treated as opaque.
2. **Normalized fields** are filled only when confidently interpretable (`status`, `err`, `imsi`, `mcc`, `mnc`, `cn`, `net`, roaming hints). Everything else stays in the raw payload.
3. **Reachability**: `status` in `{1,2}` and `err` in `{null,0}` → `reachable`; terminal failure statuses / non-zero `err` → `unreachable` with `lifecycleStatus=completed` (billing can capture later).
4. **Credentials** come from env (`SMSC_API_KEY` or `SMSC_LOGIN`+`SMSC_PASSWORD`). Never hardcoded; never logged.
5. **Currency** label defaults to `SMSC_CURRENCY` / `RUB` — SMSC often omits ISO currency in JSON.
6. **Idempotency / dedupe** (defense in depth):
   - local: reuse `SUCCEEDED` SEND by `idempotencyKey`; block second call while `PENDING` (`ProviderError.kind=conflict`)
   - DB: partial unique index on active `(providerCode, tenantId, idempotencyKey)` for PENDING|SUCCEEDED
   - SMSC: stable client `id` (31-bit hash of the key) so provider-side retries do not create a new message
   - callbacks: `dedupeKey` fingerprint + unique index; duplicate ingest returns `deduplicated=true`
   - FAILED keys may be retried (partial unique allows a new PENDING after FAILED)
7. **Retries**: only transport timeouts / network failures / HTTP 408,425,429,5xx. Application `error_code` is not retried (except SMSC `9` rate-limit, surfaced as retryable `ProviderError`).
8. **Adapter scope**: no billing, no job state machine, no public API workflows.

## Persistence

Inject `ProviderPersistencePort`. Each check I/O row keeps **three artefacts separately**:

| Artefact | Outbound (`provider_requests`) | Inbound (`provider_callbacks`) |
|----------|--------------------------------|--------------------------------|
| Raw request | `requestPayload` (secrets redacted) | — |
| Raw response / body | `responsePayload` | `rawPayload` (`body` + `_meta.dedupeKey`) |
| Normalized snapshot | `normalizedResult` | `normalizedResult` |

Raw is never overwritten by mapping changes — re-run `mapProviderResponse(raw)` anytime.  
`normalizedResult` is the snapshot at write time (useful for audit / “what did we decide then?”).

COST/BALANCE calls store raw req/res only (no check-shaped `NormalizedResult`).

Nest wires Prisma in `apps/api`. Packages stay DB-agnostic.

## Extension points

- New provider: implement `NumberLookupProvider` in another package; bind via `NUMBER_LOOKUP_PROVIDER`.
- Alternate HTTP transport: pass a custom `SmscHttpClient` / `fetchImpl`.
- Mapping tweaks: keep changes inside `mapper.ts` so apps stay stable on `NormalizedResult`.
- Callback HTTP route + job finalize: next stages (E09/E10), not this package.

## Config

| Env | Meaning |
|-----|---------|
| `SMSC_BASE_URL` | default `https://smsc.ru` |
| `SMSC_LOGIN` / `SMSC_PASSWORD` | login auth |
| `SMSC_API_KEY` | alternative to login/password |
| `SMSC_CURRENCY` | default `RUB` |
| `SMSC_TIMEOUT_MS` | default `15000` |
| `SMSC_RETRY_MAX` | extra retries after first try (default `2`) |
| `SMSC_RETRY_BASE_DELAY_MS` | default `200` |
| `SMSC_CALLBACK_SECRET` | md5/sha1 shared secret; empty = skip verify |

## Tests

```bash
pnpm --filter @finenumbers/provider-smsc test
```

Coverage: response mapping, error mapping, callback parsing/signature, HTTP timeout/retry, submit dedupe.
