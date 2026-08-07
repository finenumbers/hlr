# Deployment

Related: [MONITORING.md](./MONITORING.md), [BACKUP_RESTORE.md](./BACKUP_RESTORE.md), [RUNBOOK.md](./RUNBOOK.md), [operations.md](./operations.md).

## Target topology (MVP)

| Layer | Role |
|-------|------|
| **Portainer** (or Compose CLI) | Deploy/update the app stack from GHCR |
| **App stack** | `postgres`, `redis`, `api`, `worker`, `web` |
| **External Nginx Proxy Manager** | TLS termination + host routing (separate from this stack) |

No Kubernetes required. Data plane stays on internal `hlr_net`; `api` / `web` also join external Docker network **`proxy`** where NPM already runs.

| Service | Role | Reachability |
|---------|------|----------------|
| `postgres` | Primary data | `127.0.0.1:5432` + `hlr_net` only |
| `redis` | BullMQ + rate limits (AOF) | `127.0.0.1:6379` + `hlr_net` only |
| `api` | NestJS HTTP | `127.0.0.1:3001` + `http://api:3001` on **`proxy`** |
| `worker` | BullMQ + `/metrics:9091` | `hlr_net` only |
| `web` | Next.js UI | `127.0.0.1:3000` + `http://web:3000` on **`proxy`** |
| obs (optional) | Prometheus / Grafana / Loki | see `docker-compose.obs.yml` |

## Container images (GHCR)

Установка из GitHub / Portainer **всегда** использует только тег **`latest`** (ветка `main` + образы `:latest`). Другие теги (`sha-…`, semver) для этого пути не используются.

| Image |
|-------|
| `ghcr.io/finenumbers/hlr-api:latest` |
| `ghcr.io/finenumbers/hlr-worker:latest` |
| `ghcr.io/finenumbers/hlr-web:latest` |

Пакеты **public** — Portainer тянет без логина в registry. У сервисов `pull_policy: always`.

## Prerequisites

1. Portainer (или Docker Compose v2).
2. Docker-сеть **`proxy`** уже существует (обычно её создаёт стек NPM):

   ```bash
   docker network create proxy   # только если сети ещё нет
   ```

3. Внешний **Nginx Proxy Manager** уже подключён к сети `proxy`.
4. Минимальный набор env — см. ниже.
5. Публичные hostname для web + API; callback SMSC доступен из интернета.

## Env для Portainer (минимум)

Шаблон с пояснениями: [`infra/docker/.env.portainer.example`](../infra/docker/.env.portainer.example).

| Переменная | Зачем |
|------------|--------|
| `POSTGRES_PASSWORD` | Пароль базы Postgres (**не** логин на сайт) |
| `API_KEY_PEPPER` | Секрет для API-ключей клиентов (**не** логин на сайт) |
| `PUBLIC_API_URL` | Публичный HTTPS API (браузер ходит сюда при логине) |
| `PUBLIC_WEB_URL` | Публичный HTTPS кабинета |
| `SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD` | **Вход в админку** `/admin/login` (пароль ≥16, не `ChangeMeNow!`) |
| `SMSC_LOGIN` + `SMSC_PASSWORD` | Доступ к SMSC.ru (или `SMSC_API_KEY`) |
| `SMSC_CALLBACK_SECRET` | Секрет подписи callback от SMSC |

Клиентов seed не создаёт — только platform settings + superadmin.  
`SEED_SUPERADMIN_PASSWORD` **обязателен** (Compose требует переменную): длина ≥16, нельзя `ChangeMeNow!`.  
Seed **не перезаписывает** пароль при каждом migrate. Чтобы сбросить: один раз `SEED_RESET_PASSWORD=true` + Redeploy, затем вернуть `false`.

После смены `SEED_SUPERADMIN_*` в Portainer — **Update/Redeploy** и проверьте логи `migrate`.

Секреты не коммитьте — только в Environment variables стека Portainer.

---

## Deploy with Portainer (recommended)

### 1. Create the stack

Portainer → **Stacks** → **Add stack** → **Repository**:

- Repository URL: `https://github.com/finenumbers/hlr`
- Compose path: `docker-compose.portainer.yml`
- Branch: **`main`** (только latest-код)
- При желании включите автообновление стека при изменении compose в `main`

### 2. Stack environment

Скопируйте значения из [`infra/docker/.env.portainer.example`](../infra/docker/.env.portainer.example) и подставьте свои секреты/домены.

Deploy. Сеть `hlr_net` создаётся автоматически; сеть **`proxy` должна уже существовать** (external).

### 3. Migrations & first admin

Сервис **`migrate`** в стеке сам делает `prisma migrate deploy` + seed (создание админа). Отдельно запускать не нужно.

Если логин не работает после старого деплоя: **Pull and redeploy** стека (пересоздаст seed-пароль из `SEED_*`) и проверьте, что `PUBLIC_API_URL` в env — тот же HTTPS-хост, что у API в NPM.

### 4. Update

Всегда latest: Portainer → stack → **Pull and redeploy**.

Проверка: `/health/live`, `/health/ready`, вход `SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD`.

---

## External Nginx Proxy Manager

NPM **не** входит в этот compose. Предполагается отдельный стек NPM в Docker-сети **`proxy`**.

Стек HLR подключает к `proxy` только `api` и `web`. База и Redis в `proxy` не попадают.

### Proxy Hosts в NPM

| Domain | Scheme | Forward hostname | Forward port | Notes |
|--------|--------|------------------|--------------|--------|
| `app.example.com` | `http` | `web` | `3000` | Websockets on if needed |
| `api.example.com` | `http` | `api` | `3001` | Public API + health + SMSC callback |

Enable SSL (Let's Encrypt) on both hosts. Always pass / preserve:

- `X-Forwarded-For`
- `X-Forwarded-Proto`
- `X-Forwarded-Host` / `Host`

В стеке уже `TRUST_PROXY=true`, чтобы `req.ip` и rate limits видели IP клиента.

```text
Internet → NPM (TLS) ──proxy──► web:3000
                    └─────────► api:3001
```

### Fallback: host ports

Если NPM по какой-то причине не в сети `proxy`, на том же хосте можно слать на `127.0.0.1:3000` / `127.0.0.1:3001` (порты стека слушаются только на localhost).

### SMSC callback

Configure in SMSC cabinet:

`https://api.example.com/internal/smsc/callback`

Accepts POST (body/query) and GET (query). Signature: md5/sha1 of `id:phone:status:<SMSC_CALLBACK_SECRET>` (fields in payload or `X-SMSC-MD5` / `X-SMSC-SHA1` headers).

---

## Deploy with Compose CLI (alternative)

Предпочтительно тот же Portainer-файл (всегда `:latest`):

```bash
cp infra/docker/.env.portainer.example .env
# заполните значения

docker compose -f docker-compose.portainer.yml pull
docker compose -f docker-compose.portainer.yml up -d
```

Local build fallback (dev, без GHCR):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Migrations (host with repo checkout):

```bash
export DATABASE_URL=postgresql://...@127.0.0.1:5432/finenumbers?schema=public
pnpm --filter @finenumbers/db prisma migrate deploy
pnpm --filter @finenumbers/db prisma db seed   # first boot only
```

Observability overlay (отдельный compose, не Portainer-стек):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.obs.yml up -d
```

---

## Safe deploy sequence

1. Take Postgres **logical** dump (+ confirm WAL archive is advancing); see [BACKUP_RESTORE.md](./BACKUP_RESTORE.md).
2. Portainer → **Pull and redeploy** (`:latest` + compose с `main`).
3. `prisma migrate deploy` (never `migrate dev` in prod).
4. Rolling restart: `worker` → `api` → `web` (workers drain BullMQ jobs on SIGTERM).
5. Verify `GET /health/live`, `GET /health/ready`, Grafana “Finenumbers Overview” if obs is enabled.
6. Smoke: login → submit check → webhook delivery.
7. After risky schema changes: also take a fresh **base backup**.

## CI

GitHub Actions (`.github/workflows/ci.yml`): lint, typecheck, test, build, then publish `hlr-{api,worker,web}` to GHCR. Deploy remains Portainer / Compose + external NPM.

## Swagger / OpenAPI / security headers

Production hard rules (cannot be overridden by env):

- Swagger UI (`/docs`, `/docs-json`) → **404**
- OpenAPI contract (`/openapi.json`) → **404**
- `OPENAPI_ENABLED=true` is **ignored** when `NODE_ENV=production`

Non-production: `/docs` + `/openapi.json` available for local/staging; set `OPENAPI_ENABLED=false` to turn the contract off.

### API hardening

- Helmet: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, HSTS (prod), API CSP `default-src 'none'`
- CORS: allow-list from `CORS_ORIGINS` / `PUBLIC_WEB_URL` only; credentials on; rate-limit headers exposed
- Set `CORS_ORIGINS=https://app.example.com` in production (do not leave localhost)
- **NPM:** add a Custom Location (or deny rule) for ` /metrics` → 404/403. Prometheus scrapes `api:3001/metrics` on the Docker network only — do not expose metrics on the public API host.
- **NPM body size:** set `client_max_body_size` (Custom Nginx Config on the API proxy host) to at least **52m** so cabinet CSV preview uploads are not rejected before the API. Align with `BODY_LIMIT_CSV` / proxy read timeouts ≥ `REQUEST_TIMEOUT_CSV_MS` (default 120s).

### Web hardening

Next.js sets security headers for all routes (CSP, frame deny, nosniff, Referrer-Policy, Permissions-Policy, HSTS in prod). `connect-src` includes `PUBLIC_API_URL`.
