# `@finenumbers/db`

Prisma schema, migrations, seed and client export for Finenumbers.

## Models (overview)

| Model | Table | Role |
|-------|-------|------|
| `Tenant` | `tenants` | Multi-tenant organization |
| `User` | `users` | Platform or tenant user |
| `TenantMembership` | `tenant_memberships` | User↔tenant + role |
| `Session` | `sessions` | DB-backed auth sessions (optional) |
| `ApiKey` | `api_keys` | Public API keys (`prefix` + `secretHash`) |
| `Wallet` | `wallets` | Cached `availableBalance` / `heldBalance` |
| `WalletTransaction` | `wallet_transactions` | Ledger (source of truth) |
| `TariffPlan` | `tariff_plans` | Catalog sell prices + provider costs for HLR/Ping |
| `TenantTariff` | `tenant_tariffs` | Plan assignment (+ optional overrides) |
| `Job` | `jobs` | Batch / single / API job wrapper |
| `JobItem` | `job_items` | One phone check + normalized result |
| `ProviderRequest` | `provider_requests` | Outbound provider call + raw payloads |
| `ProviderCallback` | `provider_callbacks` | Inbound provider callback + raw payload |
| `WebhookEndpoint` | `webhook_endpoints` | Client webhook config |
| `WebhookDelivery` | `webhook_deliveries` | Delivery attempts / status |
| `PlatformSettings` | `platform_settings` | Singleton runtime settings |
| `AuditLog` | `audit_logs` | Security / admin / finance audit |
| `IdempotencyRecord` | `idempotency_records` | Public API idempotency cache |

## Architectural notes

- **Tenant isolation** is explicit: most domain rows carry `tenantId`.
- **Money** uses `Decimal(18,6)`. Never float.
- **Ledger**: `CREDIT` / `DEBIT` / `HOLD` / `RELEASE` / `ADJUSTMENT`. Wallet balances are materializations updated in the same DB transaction as ledger writes.
- **Billing policy mapping**: hold ≈ reserve, debit (linked via `relatedHoldId`) ≈ capture, release ≈ unreserve, credit ≈ top-up.
- **No separate `Check` table**: `JobItem` is the check unit. Single API checks are still `Job` + one `JobItem`.
- **Provider-agnostic**: `providerCode` on items/requests/callbacks (`smsc` default). Raw JSON stays in provider tables; normalized fields live on `JobItem`.
- **API keys**: store only `prefix` + hashed secret; scopes as `String[]`.

## Commands

From repo root (requires `DATABASE_URL`):

```bash
pnpm --filter @finenumbers/db validate
pnpm --filter @finenumbers/db generate
pnpm --filter @finenumbers/db migrate:dev
pnpm --filter @finenumbers/db seed
```

Seed defaults (override via env):

| Env | Default |
|-----|---------|
| `SEED_SUPERADMIN_EMAIL` | `admin@finenumbers.local` |
| `SEED_SUPERADMIN_PASSWORD` | `ChangeMeNow!` |
| `SEED_DEMO_ADMIN_EMAIL` | `demo@finenumbers.local` |
| `SEED_DEMO_ADMIN_PASSWORD` | `ChangeMeNow!` |

Tariffs are **not** seeded (admin creates them later).
