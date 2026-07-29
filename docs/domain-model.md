# Domain model — Finenumbers

Канон: [plan.md](./plan.md). Prisma: [`packages/db`](../packages/db/README.md).

---

## Сущности

| Prisma model | Table | Смысл |
|--------------|-------|--------|
| `Tenant` | `tenants` | Тенант (организация) |
| `User` | `users` | Пользователь (platform и/или tenant) |
| `TenantMembership` | `tenant_memberships` | Связь user↔tenant + роль |
| `Session` | `sessions` | DB-сессии (под auth) |
| `ApiKey` | `api_keys` | Ключ `/v1` (`prefix` + `secretHash`) |
| `PlatformSettings` | `platform_settings` | Singleton runtime-настроек |
| `TariffPlan` | `tariff_plans` | Каталог цен HLR/Ping |
| `TenantTariff` | `tenant_tariffs` | Назначение тарифа тенанту (+ overrides) |
| `Wallet` | `wallets` | Кэш `availableBalance` + `heldBalance` |
| `WalletTransaction` | `wallet_transactions` | Ledger: credit/debit/hold/release/adjustment |
| `Job` | `jobs` | Пакет или single-обёртка |
| `JobItem` | `job_items` | Одна проверка (номер) + normalized result |
| `ProviderRequest` | `provider_requests` | Outbound call: raw req + raw res + normalized snapshot |
| `ProviderCallback` | `provider_callbacks` | Inbound callback: raw payload + normalized snapshot |
| `WebhookEndpoint` | `webhook_endpoints` | URL + secret клиента |
| `WebhookDelivery` | `webhook_deliveries` | Попытки доставки |
| `AuditLog` | `audit_logs` | Админ/фин/security события |
| `IdempotencyRecord` | `idempotency_records` | Кэш ответов create |

> Отдельной модели `Check` нет: единица проверки — `JobItem`. Single/API check = `Job` + один `JobItem`.

---

## Статусы

**JobItem:** `QUEUED → RESERVED → SENT → PENDING → COMPLETED | FAILED` (+ `CANCELLED`)

**Job:** `QUEUED → PROCESSING → COMPLETED | COMPLETED_WITH_ERRORS | FAILED | CANCELLED`

**JobItem (legacy plan names):** reserved ≈ RESERVED, sent ≈ SENT, pending ≈ PENDING, completed/failed — same.

---

## Биллинг (политика B)

Ledger types:

| Type | Смысл |
|------|--------|
| `CREDIT` | Пополнение |
| `HOLD` | Reserve при постановке в работу |
| `DEBIT` | Capture при финальном статусе провайдера (в т.ч. err) — ссылка на HOLD через `relatedHoldId` |
| `RELEASE` | Снятие hold при send-fail / timeout без финала |
| `ADJUSTMENT` | Ручная корректировка |

`Wallet.availableBalance` / `heldBalance` — кэш; истина — сумма проводок. Тарифы только из Админки. Без `TenantTariff` и без default `TariffPlan` — нельзя создать/reserve check (`TARIFF_NOT_CONFIGURED`). Sell price и provider cost разделены (`hlrPrice`/`pingPrice` vs `hlrProviderCost`/`pingProviderCost`).

---

## Лимиты

`apiKey.rateLimitRpm ?? tenant.* ?? PlatformSettings`

- `defaultRateLimitRpm` / `rateLimitRpm`
- `maxCsvRows` / `maxCsvBytes` / `maxBatchPhones`

---

## Телефоны

Хранить canonical E.164 в `JobItem.phoneE164`. Любая страна. Invalid → 400 (application layer).

---

## Роли

| Уровень | Enum | Значения |
|---------|------|----------|
| Platform | `PlatformRole` | `SUPERADMIN`, `SUPPORT` (nullable на User) |
| Tenant | `MembershipRole` | `OWNER`, `ADMIN`, `MEMBER` |

Соответствие плану: `platform_admin` → `SUPERADMIN`, `platform_support` → `SUPPORT`, `org_owner` → `OWNER`, `org_member` → `MEMBER` (+ `ADMIN` для tenant admins).

---

## Индексы / uniqueness (ключевое)

- `Tenant.slug` unique
- `User.email` unique
- `TenantMembership (tenantId, userId)` unique
- `ApiKey.prefix` unique
- `Wallet.tenantId` unique
- `TenantTariff.tenantId` unique (одно текущее назначение)
- `Job (tenantId, idempotencyKey)` unique
- `WalletTransaction (tenantId, idempotencyKey)` unique
- `IdempotencyRecord (tenantId, key)` unique
- Списки: `(tenantId, createdAt)` на jobs/items/ledger/webhooks/audit
- Provider lookup: `(providerCode, providerMessageId)` на job_items / provider_requests / provider_callbacks
- Webhook retry: `(status, nextAttemptAt)` на deliveries
