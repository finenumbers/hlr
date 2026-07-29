# Todos — Finenumbers HLR Lookup Service

Практические задачи для отдельных чатов.  
Брать **одну задачу или один этап (E0X)** за раз.  
Канон: [plan.md](./plan.md).

Легенда: `[ ]` не сделано · `[x]` сделано

---

## E01 — Каркас monorepo

- [x] E01-01 Создать pnpm workspace + turbo root (`package.json`, `pnpm-workspace.yaml`, `turbo.json`)
- [x] E01-02 Добавить `packages/tsconfig` (base configs)
- [x] E01-03 Добавить `packages/config` (заготовка zod-env)
- [x] E01-04 Создать NestJS skeleton `apps/api` с `/health/live`
- [x] E01-05 Создать NestJS skeleton `apps/worker` с noop bootstrap
- [x] E01-06 Создать Next.js skeleton `apps/web`
- [ ] E01-07 Создать Next.js skeleton `apps/admin` _(отложено: не входил в Stage 1 scaffold-запрос)_
- [x] E01-08 ESLint + Prettier на root
- [x] E01-09 `.gitignore` + `.env.example` (пустые ключи)
- [x] E01-10 Краткий `README.md`: install / dev команды

**Чат:** «Сделай E01 по docs/plan.md и все E01-* из docs/todos.md»

---

## E02 — Docker Compose (Postgres + Redis)

- [x] E02-01 `docker-compose.yml`: postgres + redis + volumes + healthchecks _(плюс api/worker/web/obs в Stage 1 scaffold)_
- [x] E02-02 Прописать `DATABASE_URL` / `REDIS_URL` в `.env.example`
- [ ] E02-03 Секция local в `docs/operations.md` _(частично закрыто README; sync operations.md — отдельно)_
- [ ] E02-04 Проверить подключение с хоста (psql/redis-cli или временный ping из api)

**Чат:** «Сделай E02…»

---

## E03 — Prisma schema

- [x] E03-01 Инициализировать `packages/db` + Prisma
- [x] E03-02 Модели: Tenant, User, TenantMembership, Session
- [x] E03-03 Модели: ApiKey, PlatformSettings, AuditLog
- [x] E03-04 Модели: Wallet, WalletTransaction, TariffPlan, TenantTariff
- [x] E03-05 Модели: Job, JobItem, ProviderRequest, ProviderCallback (Check свёрнут в JobItem)
- [x] E03-06 Модели: WebhookEndpoint, WebhookDelivery, IdempotencyRecord
- [x] E03-07 Индексы: tenantId+createdAt, providerMessageId, unique tenantId+idempotencyKey
- [x] E03-08 Первая migration
- [x] E03-09 Seed: PlatformSettings + superadmin + demo tenant/admin (без тарифов)
- [x] E03-10 Экспорт Prisma client из `@finenumbers/db`
- [x] E03-11 Обновить `docs/domain-model.md` под фактические имена полей

**Чат:** «Сделай E03…»

---

## E04 — Auth + RBAC

- [ ] E04-01 Хэш паролей (argon2/bcrypt)
- [ ] E04-02 Login/logout admin (`/admin/auth`)
- [ ] E04-03 Login/logout cabinet (`/cabinet/auth`)
- [ ] E04-04 Session или JWT — один выбранный механизм + guards
- [ ] E04-05 Роли и permission decorators
- [ ] E04-06 Тест: org A не видит данные org B
- [ ] E04-07 Запрет self-serve регистрации (роутов нет)

**Чат:** «Сделай E04…»

---

## E05 — Tenants, users, API keys

- [ ] E05-01 Admin API: создать/список Organization
- [ ] E05-02 Admin API: создать User + Membership в org
- [ ] E05-03 Cabinet/Admin: смена пароля (базово)
- [x] E05-04 Генерация API key + prefix + hash + pepper из env _(via `/v1/api-keys`)_
- [x] E05-05 Показ raw key только один раз при создании
- [x] E05-06 Revoke API key
- [x] E05-07 Guard заготовки под Bearer API key (пока без /v1 checks)

**Чат:** «Сделай E05…»

---

## E06 — PlatformSettings + org limits

- [ ] E06-01 Get/Update PlatformSettings (platform_admin)
- [ ] E06-02 Per-org overrides: rpm, maxCsvRows, maxCsvBytes, maxBatchPhones
- [x] E06-03 `resolveLimits(orgId)` cascade: key → org → platform _(minimal helper for public API RPM; admin CRUD still open)_
- [ ] E06-04 Redis cache + invalidate on update
- [ ] E06-05 AuditLog на изменение settings/limits
- [ ] E06-06 Убедиться, что SMSC secrets нельзя записать через settings API

**Чат:** «Сделай E06…»

---

## E07 — Billing + tariffs + topup

- [x] E07-01 Создание Wallet при создании org (`ensureWallet` on topup/reserve; seed demo wallet)
- [x] E07-02 Admin: Tariff CRUD (sell + provider cost for HLR/Ping) — API
- [x] E07-03 Назначение default tariff / per-org tariff
- [x] E07-04 Admin: manual topup + audit + ledger `CREDIT`
- [x] E07-05 `reserve` с блокировкой wallet (`SELECT … FOR UPDATE`)
- [x] E07-06 `capture` идемпотентно
- [x] E07-07 `release` идемпотентно
- [x] E07-08 Отказ при отсутствии тарифа
- [x] E07-09 Integration-тесты ledger (happy + idempotency + override)

**Чат:** «Сделай E07…»

---

## E08 — Provider SMSC package

- [x] E08-01 `packages/provider-core`: типы + интерфейс `NumberLookupProvider`
- [x] E08-02 SMSC HTTP client: send HLR (`hlr=1`, `fmt=3`)
- [x] E08-03 SMSC HTTP client: send Ping (`ping=1`, `fmt=3`)
- [x] E08-04 status.php + balance.php + cost estimate
- [x] E08-05 Normalizer → NormalizedResult
- [x] E08-06 Unit-тесты на fixtures (JSON ответы)
- [x] E08-07 Env: SMSC_* только в config пакете/apps

**Чат:** «Сделай E08…»

---

## E09 — Callback + poll + raw payloads

- [ ] E09-01 Endpoint `POST /internal/smsc/callback`
- [ ] E09-02 Проверка подписи md5/sha1
- [ ] E09-03 Сохранение ProviderPayload (callback)
- [ ] E09-04 Идемпотентный finalize check из callback
- [ ] E09-05 BullMQ `checks.poll` processor
- [ ] E09-06 Backoff + max attempts из PlatformSettings
- [ ] E09-07 Защита от double-charge при callback+poll

**Чат:** «Сделай E09…»

---

## E10 — Checks/Jobs send pipeline

- [x] E10-01 Сервис создания Job(single)+JobItem (`@finenumbers/jobs` CreateJobService)
- [x] E10-02 Enqueue `jobs-submit` batches (BullMQ; billing reserve via `@finenumbers/billing`)
- [x] E10-03 submit processor → provider adapter → providerMsgId → pending
- [x] E10-04 На send error → item FAILED + billing `release` hook
- [x] E10-05 На completed (в т.ч. err) → billing `capture` hook
- [x] E10-06 Timeout path → FAILED + `release` hook; poll fallback queue
- [x] E10-07 Raw req/res via provider adapter persistence (`provider_requests`)
- [x] E10-08 Обновление счётчиков Job + `jobs-finalize`

**Чат:** «Сделай E10…» / Stage 5 jobs subsystem

---

## E11 — Public API /v1

- [x] E11-01 `GET /v1/me`, `GET /v1/balance`
- [x] E11-02 `POST /v1/checks` → 202 (hlr|ping)
- [x] E11-03 `GET /v1/checks/:id`, `GET /v1/checks`
- [x] E11-04 API key auth на всём `/v1`
- [x] E11-05 Rate limit RPM из resolveLimits
- [x] E11-06 Idempotency-Key на POST create
- [x] E11-07 Ошибки: 400/401/402/409/429
- [x] E11-08 Обновить `docs/api-outline.md` фактическими контрактами
- [x] E11-09 E.164 валидация (libphonenumber), reject invalid _(via CreateJobService)_

**Чат:** «Сделай E11…»

---

## E12 — CSV bulk

- [ ] E12-01 `POST /v1/jobs` multipart CSV + JSON phones[]
- [ ] E12-02 Сохранение файла в `UPLOAD_DIR`
- [ ] E12-03 csv-parse processor (stream)
- [ ] E12-04 Проверка maxCsvRows/Bytes/Batch из settings
- [ ] E12-05 Fan-out enqueue send по items
- [x] E12-06 `GET /v1/jobs/:id`, `GET /v1/jobs/:id/items` _(JSON bulk path; CSV multipart still E12)_
- [ ] E12-07 Job status `completed_with_errors`

**Чат:** «Сделай E12…»

---

## E13 — Webhooks

- [x] E13-01 CRUD WebhookEndpoint (cabinet + /v1) _(`/v1` done; cabinet BFF deferred)_
- [x] E13-02 Подпись HMAC-SHA256 (`X-Finenumbers-Signature: t=…,v1=…`)
- [x] E13-03 События: check.completed, check.failed, job.completed
- [x] E13-04 deliver processor + retries из settings
- [x] E13-05 WebhookDelivery лог попыток
- [x] E13-06 Авто-disable после N ошибок подряд

**Чат:** «Сделай E13…»

---

## E14 — Кабинет web

- [ ] E14-01 Скопировать branding assets; horizontal logo без заливки фона
- [ ] E14-02 Favicon + title «Finenumbers HLR Lookup Service»
- [ ] E14-03 i18n ru/en + переключатель
- [ ] E14-04 Login page
- [ ] E14-05 Dashboard (balance, recent jobs)
- [ ] E14-06 API Keys UI
- [ ] E14-07 Checks list/detail
- [ ] E14-08 Jobs + CSV upload UI
- [ ] E14-09 Webhooks UI + deliveries
- [ ] E14-10 Balance / read-only tariff info

**Чат:** «Сделай E14…»

---

## E15 — Админка admin

- [ ] E15-01 Branding + favicon + i18n ru/en
- [ ] E15-02 Login
- [ ] E15-03 Orgs CRUD + assign tariff + org limits
- [ ] E15-04 Users create/membership/roles
- [ ] E15-05 Tariff CRUD
- [ ] E15-06 Manual topup UI
- [ ] E15-07 PlatformSettings editor
- [ ] E15-08 Checks/Jobs explorer
- [ ] E15-09 Audit log viewer
- [ ] E15-10 SMSC balance/health widget (read-only)

**Чат:** «Сделай E15…»

---

## E16 — Observability

- [x] E16-01 prom-client metrics в api
- [x] E16-02 metrics в worker (queue depth, smsc errors)
- [x] E16-03 `docker-compose.obs.yml` + prometheus config
- [x] E16-04 Grafana datasource + базовый dashboard
- [x] E16-05 Loki + JSON logging
- [x] E16-06 Masking телефонов в логах
- [x] E16-07 Retention job по `dataRetentionDays` (`PlatformSettings.retentionDays`)
- [x] E16-08 Дописать `docs/operations.md` (obs) + MONITORING/RUNBOOK

**Чат:** «Сделай E16…»

---

## E17 — Prod Docker + NPM

- [x] E17-01 Dockerfiles для api/worker/web _(admin UI внутри web; отдельного apps/admin нет)_
- [x] E17-02 Prod compose (все сервисы + volumes uploads) — `docker-compose.prod.yml`
- [x] E17-03 Документировать NPM: app/api upstreams + TLS — `docs/DEPLOYMENT.md`
- [x] E17-04 Документировать SMSC callback URL
- [x] E17-05 trust proxy / X-Forwarded-* (`TRUST_PROXY` + helmet/CORS hardening)
- [x] E17-06 Пилотный чеклист: admin → tariff → org → topup → check → webhook — RUNBOOK
- [x] E17-07 Финальный проход по `docs/operations.md` + BACKUP_RESTORE / CI

**Чат:** «Сделай E17…»

---

## После MVP (не брать сейчас)

- [ ] Платёжный шлюз / счета  
- [ ] Provider #2  
- [ ] OpenAPI codegen в CI  
- [ ] White-label  
