# Finenumbers HLR Lookup Service — Implementation Plan

Финальный план MVP. Код здесь не описывается построчно — только решения, границы этапов и критерии готовности.  
Каждый этап рассчитан на **отдельный реализационный чат**. Чеклист задач: [todos.md](./todos.md).

---

## 1. Продукт

**Бренд:** Finenumbers HLR Lookup Service  

B2B SaaS поверх SMSC.ru: клиенты проверяют телефонные номера (HLR и Ping-SMS), платят с внутреннего баланса, работают через кабинет и публичный API.

### MVP

1. HLR-проверки  
2. Ping-SMS проверки  
3. Кабинет клиента  
4. Админка  
5. Баланс + ручное пополнение  
6. Внутренние тарифы и биллинг  
7. CSV bulk через очередь  
8. Публичный API  
9. Webhook’и  
10. Логи, аудит, мониторинг  

### Вне MVP

- Self-serve регистрация и платёжный шлюз  
- Sync-ожидание результата в HTTP  
- Отдельные SMSC-креды на тенанта  
- Второй провайдер (только порт под него)  
- White-label, postpaid  

---

## 2. Зафиксированные решения

| Тема | Решение |
|------|---------|
| Стек | pnpm monorepo, Next.js+TS, NestJS+TS, PostgreSQL, Prisma, Redis+BullMQ, Docker Compose, Prometheus+Grafana+Loki |
| Онбординг | Только из Админки (без публичной регистрации) |
| API | Только async: `202` + poll / webhook |
| Биллинг | reserve → **capture при `completed`** (включая provider `err` / недоступен) → **release** если send не удался или timeout до финального статуса |
| Номера | Любой валидный E.164 |
| UI | RU + EN |
| Лимиты CSV/RPM и прочие runtime-настройки | Админка (`PlatformSettings` + per-org) |
| Тарифы | Только CRUD в Админке |
| Secrets SMSC | Только `.env` на backend |
| Bulk | Только через jobs + BullMQ |
| Raw provider payload | Сохраняем в БД |
| Хостинг | Docker Compose + внешний Nginx Proxy Manager |
| Логотип горизонтальный | Прозрачный фон; **не** заливать контейнер цветом |

**Бренд-ассеты** (уже в репо: [docs/branding/](./branding/assets.md)):

- `docs/branding/assets/logo-horizontal.png` — прозрачный фон; при E14/E15 → `apps/*/public/branding/`  
- `docs/branding/assets/icon-512.png`, `favicon.png` → metadata / `public`  

---

## 3. Структура monorepo

```
apps/
  api/          # NestJS: /v1, /cabinet, /admin, /internal
  worker/       # BullMQ processors
  web/          # кабинет клиента (Next.js)
  admin/        # админка платформы (Next.js)
packages/
  db/             # Prisma
  shared/         # zod, phone, money, enums
  provider-core/  # интерфейс провайдера
  provider-smsc/  # SMSC HTTP
  config/         # парсинг .env
  tsconfig/
deploy/
  docker/
  prometheus/
  grafana/
  loki/
docs/             # эта документация
docker-compose.yml
docker-compose.obs.yml
```

Подробнее: [architecture.md](./architecture.md), [domain-model.md](./domain-model.md), [api-outline.md](./api-outline.md), [operations.md](./operations.md).

---

## 4. Ключевые потоки (кратко)

### Проверка (single = тоже Job)

1. Клиент `POST /v1/checks` или CSV → создаётся `Job` + `JobItem` + `Check`  
2. `reserve` по тарифу  
3. Worker шлёт в SMSC (`hlr=1` или `ping=1`, `fmt=3`)  
4. Callback и/или poll → нормализация → `completed`/`failed`  
5. При финальном результате от провайдера (в т.ч. err) → `capture`  
6. При ошибке send / timeout без финала → `release`  
7. Webhook клиенту (если настроен)  

### Конфиг

- `.env`: секреты, URL’ы за NPM, пути, SMSC credentials  
- Админка: лимиты, timeouts, poll, webhook retries, retention, currency, `smscBaseUrl`, и т.п.  

---

## 5. Этапы реализации (отдельные чаты)

Правило: один чат = один этап. В чат вставлять: цель этапа + ссылку на этот файл + нужные задачи из [todos.md](./todos.md).

---

### Этап E01 — Каркас monorepo

**Цель:** пустой, но собираемый monorepo с apps/packages и базовым tooling.

**Файлы/директории:**

- `package.json`, `pnpm-workspace.yaml`, `turbo.json`  
- `packages/tsconfig/`, `packages/config/`  
- `apps/api`, `apps/worker`, `apps/web`, `apps/admin` (hello/boot)  
- ESLint/Prettier, `.gitignore`, `.env.example`  
- `README.md` (как поднять локально — кратко)  

**Готово когда:**

- `pnpm install` проходит  
- каждое app стартует (хотя бы health/hello)  
- turbo pipeline `build`/`lint` объявлен  

**Риски:** лишняя сложность turbo на старте — держать конфиг минимальным.

---

### Этап E02 — Docker Compose (Postgres + Redis)

**Цель:** локальная инфраструктура данных.

**Файлы/директории:**

- `docker-compose.yml` (postgres, redis; volumes)  
- `.env.example` (`DATABASE_URL`, `REDIS_URL`)  
- `docs/operations.md` (секция local)  

**Готово когда:**

- `docker compose up -d postgres redis` стабильно  
- api/worker могут подключиться к URL из env  

**Риски:** порты заняты на машине разработчика — вынести в `.env`.

---

### Этап E03 — Prisma schema (ядро сущностей)

**Цель:** схема БД под multi-tenant, billing, jobs, checks, settings, audit.

**Файлы/директории:**

- `packages/db/prisma/schema.prisma`  
- `packages/db` client export (`@finenumbers/db`)  
- первая migration (`init_domain`)  
- seed: `PlatformSettings` + superadmin only (без демо-клиентов и тарифов)  

**Готово когда:**

- `prisma migrate` на чистой БД ок  
- все сущности из [domain-model.md](./domain-model.md) описаны  
- seed поднимает settings + superadmin (клиентов создаёте в админке)  

**Риски:** слишком рано тащить все индексы — добавить минимально нужные, расширять по мере API.  
**Статус:** сделано (Tenant вместо Organization; Check свёрнут в JobItem; ledger = WalletTransaction).

---

### Этап E04 — Auth + RBAC

**Цель:** логин админки и кабинета, роли, guards.

**Файлы/директории:**

- `apps/api/src/modules/auth/`, `rbac/`  
- session/JWT стратегия  
- password hashing  
- базовые `/admin/auth/*`, `/cabinet/auth/*`  

**Готово когда:**

- platform_admin логинится  
- org user логинится  
- чужой org недоступен (тест изоляции)  
- роли: `platform_admin`, `platform_support`, `org_owner`, `org_member`  

**Риски:** cookie vs bearer для SPA — зафиксировать один подход и описать в architecture.

---

### Этап E05 — Tenants, users, API keys (без проверок)

**Цель:** админ создаёт org/user; org управляет API keys (hash).

**Файлы/директории:**

- `modules/tenants/`, `users/`, `api-keys/`  
- admin BFF routes для org/user  
- cabinet routes для api keys  

**Готово когда:**

- admin создаёт org + user  
- org_owner создаёт API key (секрет показывается один раз)  
- key хранится только как hash  

**Риски:** утечка ключа в логах — никогда не логировать raw key.

---

### Этап E06 — PlatformSettings + org limits

**Цель:** runtime-настройки из Админки, не из `.env`.

**Файлы/директории:**

- `modules/settings/`  
- модель/CRUD PlatformSettings  
- org limit overrides  
- Redis cache + invalidate  
- admin UI можно отложить, но API админки для settings — да  

**Готово когда:**

- изменение RPM/CSV limits через admin API влияет на resolveLimits(org)  
- secrets SMSC в settings не появляются  
- audit на изменение settings  

**Риски:** race cache — короткий TTL + явный invalidate.

---

### Этап E07 — Billing ledger + tariffs + topup

**Цель:** кошелёк, тарифы, ручное пополнение, reserve/capture/release.

**Файлы/директории:**

- `modules/billing/`, `tariffs/`  
- `Wallet`, `LedgerEntry`, `Tariff` сервисы  
- admin topup + tariff CRUD (API)  
- unit/integration тесты ledger  

**Готово когда:**

- topup увеличивает balance + ledger  
- reserve при нехватке → ошибка  
- capture/release идемпотентны  
- без тарифа у org — нельзя начать check (заглушка метода)  

**Риски:** гонки по Wallet — только транзакция + row lock.

---

### Этап E08 — Provider port + SMSC client

**Цель:** адаптер SMSC без полного pipeline checks.

**Файлы/директории:**

- `packages/provider-core/`  
- `packages/provider-smsc/` (send hlr/ping, status, balance, cost, normalizer)  
- fixtures/тесты нормализации  
- `docs` provider notes (кратко в architecture или отдельно)  

**Готово когда:**

- send/status парсятся из JSON fixtures  
- credentials только из env  
- интерфейс готов ко 2-му провайдеру  

**Риски:** расхождения полей HLR vs Ping — явные optional поля в NormalizedResult.

---

### Этап E09 — Callback + poll + raw payloads

**Цель:** приём статусов SMSC и fallback polling.

**Файлы/директории:**

- `apps/api/.../smsc-callback/`  
- `apps/worker/.../poll-check.processor.ts`  
- `ProviderPayload` persistence  
- verify md5/sha1  

**Готово когда:**

- callback с валидной подписью обновляет check (на тестовом double)  
- невалидная подпись → 401/403  
- poll уважает лимиты SMSC (не долбит status)  
- raw сохраняется  

**Риски:** двойной finalize (callback+poll) — идемпотентный finalize.

---

### Этап E10 — Jobs/Checks pipeline + worker send

**Цель:** полный async lifecycle одной проверки с биллингом.

**Файлы/директории:**

- `modules/checks/`, `jobs/`  
- `send-check.processor.ts`  
- finalize → capture/release  
- очереди BullMQ в api+worker  

**Готово когда:**

- создание check → reserve → send → pending → completed → capture  
- send fail → release  
- timeout → release + failed  
- single check = Job+JobItem+Check  

**Риски:** зависшие jobs — timeout из PlatformSettings.

---

### Этап E11 — Public API (keys, rate limit, idempotency)

**Цель:** внешний `/v1` для клиентов.

**Файлы/директории:**

- `apps/api` public controllers `/v1/*`  
- API key guard  
- rate limit Redis  
- IdempotencyRecord  
- черновик OpenAPI → позже `docs/api-outline.md` уточнить  

**Готово когда:**

- `POST /v1/checks` → 202  
- `GET /v1/checks/:id` отдаёт статус/результат  
- 401 без ключа, 429 при превышении RPM, 402 без средств  
- Idempotency-Key повторяет ответ  

**Риски:** разные body с тем же key → 409.

---

### Этап E12 — CSV bulk

**Цель:** загрузка CSV только через queue.

**Файлы/директории:**

- upload endpoint + `UPLOAD_DIR`  
- `csv-parse.processor.ts`  
- fan-out JobItems  
- лимиты из settings  

**Готово когда:**

- CSV → Job processing → items → checks в очереди  
- превышение maxCsvRows → отказ  
- HTTP handler не парсит тысячи строк синхронно  

**Риски:** память на больших файлах — stream parse.

---

### Этап E13 — Webhooks

**Цель:** подписанные доставки с retry.

**Файлы/директории:**

- `modules/webhooks/`  
- `webhook-deliver.processor.ts`  
- cabinet/API CRUD endpoints  

**Готово когда:**

- на `check.completed` уходит POST с HMAC  
- retries по расписанию из settings  
- deliveries пишутся в БД  

**Риски:** медленный клиентский endpoint блокирует worker — короткий timeout.

---

### Этап E14 — Кабинет (web)

**Цель:** рабочий UI клиента с брендом и i18n.

**Файлы/директории:**

- `apps/web/**`  
- `public/branding/*` (horizontal transparent, favicon)  
- pages: login, dashboard, keys, checks, jobs/CSV, webhooks, balance  
- i18n ru/en  

**Готово когда:**

- org user проходит основной сценарий без Postman  
- логотип без цветной подложки  
- переключение RU/EN работает  

**Риски:** дублирование BFF — тонкий клиент к `/cabinet` API.

---

### Этап E15 — Админка (admin)

**Цель:** управление платформой из UI.

**Файлы/директории:**

- `apps/admin/**`  
- branding/favicon  
- orgs, users, tariffs, topup, settings, limits, audit, SMSC health  
- i18n ru/en  

**Готово когда:**

- можно завести org, тариф, пополнить, выставить limits без SQL  
- settings из UI меняют поведение API  

**Риски:** случайная правка критичных settings — audit + confirm на опасных полях.

---

### Этап E16 — Observability

**Цель:** метрики, логи, дашборды, audit gaps.

**Файлы/директории:**

- `docker-compose.obs.yml`  
- `deploy/prometheus|grafana|loki/**`  
- metrics module в api/worker  
- masking телефонов в логах  
- retention job  

**Готово когда:**

- Prometheus scrapes api/worker  
- Grafana показывает базовые панели  
- Loki принимает JSON logs  
- retention чистит старые checks/payloads по settings  

**Риски:** объём логов с raw payload — raw только в БД, не в Loki.

---

### Этап E17 — Prod Docker + NPM runbook

**Цель:** прод-сборка контейнеров и инструкция для внешнего NPM.

**Файлы/директории:**

- `deploy/docker/*` Dockerfiles  
- prod compose / override  
- `docs/operations.md` (NPM vhosts, callback URL, headers)  

**Готово когда:**

- `docker compose` поднимает api/worker/web/admin/postgres/redis  
- в operations описаны прокси на app/admin/api  
- SMSC callback URL задокументирован  
- пилотный чеклист пройден на staging  

**Риски:** неправильные `X-Forwarded-*` ломают cookies/URL — проверить за NPM.

---

## 6. Документация в репозитории

| Файл | Назначение |
|------|------------|
| [plan.md](./plan.md) | Этот план (канон) |
| [todos.md](./todos.md) | Мелкие задачи по этапам |
| [architecture.md](./architecture.md) | Apps, модули, очереди, деплой |
| [domain-model.md](./domain-model.md) | Сущности, статусы, биллинг |
| [api-outline.md](./api-outline.md) | Public/cabinet/admin/internal API |
| [operations.md](./operations.md) | Local, Docker, NPM, SMSC callback, env |
| [branding/assets.md](./branding/assets.md) | Логотипы, favicon, правила использования |

Позже по мере необходимости: `docs/adr/`, OpenAPI — не блокирует старт.

---

## 7. Риски и открытые вопросы

**Риски (сквозные):** callback SMSC теряется; лимиты status API; гонки ledger; большие CSV; ПДн в raw payload.

**Открыто (не блокирует E01–E07):**

1. Точные hostname’ы для NPM  
2. Числовые seed-defaults для PlatformSettings  
3. Валюта по умолчанию (предложение: RUB)  

**Спорные (дефолт в плане):**

- Raw payload клиенту не отдаём (только admin/support)  
- Wallet: поля `balance` + `reserved`  
- api и worker — разные процессы, общий код пакетов  

---

## 8. Как вести разработку чатами

1. Открыть новый чат.  
2. Написать: «Релизуем этап E0X по docs/plan.md и задачи E0X-* из docs/todos.md».  
3. Не смешивать следующий этап, пока не закрыты критерии готовности текущего.  
4. После этапа — отметить чекбоксы в `todos.md` и коротко дописать нюансы в architecture/domain при необходимости.  
