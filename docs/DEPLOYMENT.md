# Deployment

Canonical product plan: [plan.md](./plan.md). Related: [MONITORING.md](./MONITORING.md), [BACKUP_RESTORE.md](./BACKUP_RESTORE.md), [RUNBOOK.md](./RUNBOOK.md).

## Target topology (MVP)

Docker Compose on a VPS + external **Nginx Proxy Manager** (TLS, host routing). No Kubernetes required.

| Service | Role | Host publish (prod overlay) |
|---------|------|-----------------------------|
| `postgres` | Primary data | `127.0.0.1:5432` |
| `redis` | BullMQ + rate limits (AOF on) | `127.0.0.1:6379` |
| `api` | NestJS HTTP | `127.0.0.1:3001` |
| `worker` | BullMQ processors + `/metrics:9091` | compose network only |
| `web` | Next.js cabinet/admin UI | `127.0.0.1:3000` |
| obs (optional) | Prometheus / Grafana / Loki / Promtail | see compose.obs |

## Prerequisites

1. Node 20+ / pnpm 9 for host builds; Docker + Compose v2 for runtime.
2. `.env` from `.env.example` with **strong** `API_KEY_PEPPER`, `POSTGRES_PASSWORD`, Grafana password.
3. Public hostnames for web + API; SMSC callback URL reachable from the internet.

## Env hardening (production)

Required:

- `NODE_ENV=production`
- `API_KEY_PEPPER` ≠ default
- `PUBLIC_API_URL` / `PUBLIC_WEB_URL` = public HTTPS URLs
- `TRUST_PROXY=true` (behind NPM)
- `CORS_ORIGINS` = cabinet origin(s), comma-separated
- SMSC credentials (`SMSC_LOGIN`/`SMSC_PASSWORD` or `SMSC_API_KEY`)

Never commit secrets. Prefer host/env file or secret manager; compose reads `${VAR}`.

## Bring-up

```bash
# App stack (prod binds)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# Migrations (one-shot against running postgres)
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm api \
  node -e "console.log('use host: pnpm --filter @finenumbers/db prisma migrate deploy')"
```

Preferred migration path from a deploy host with repo checkout:

```bash
export DATABASE_URL=postgresql://...@127.0.0.1:5432/finenumbers?schema=public
pnpm --filter @finenumbers/db prisma migrate deploy
pnpm --filter @finenumbers/db prisma db seed   # first boot only
```

Observability overlay:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.obs.yml up -d
```

## Nginx Proxy Manager

| Host | Forward to | Notes |
|------|------------|--------|
| `app.example.com` | `127.0.0.1:3000` | Web UI |
| `api.example.com` | `127.0.0.1:3001` | Public API + health |

Enable **Websockets** if Next needs them. Always pass:

- `X-Forwarded-For`
- `X-Forwarded-Proto`
- `X-Forwarded-Host` / `Host`

API must run with `TRUST_PROXY=true` so `req.ip` and rate limits see the client IP.

### SMSC callback

Configure in SMSC cabinet:

`https://api.example.com/internal/smsc/callback`

(Exact path may match the callback controller when wired; keep secret in `SMSC_CALLBACK_SECRET`.)

## Safe deploy sequence

1. Take Postgres **logical** dump (+ confirm WAL archive is advancing); see [BACKUP_RESTORE.md](./BACKUP_RESTORE.md).
2. Pull/build images.
3. `prisma migrate deploy` (never `migrate dev` in prod).
4. Rolling restart: `worker` → `api` → `web` (workers drain BullMQ jobs on SIGTERM).
5. Verify `GET /health/live`, `GET /health/ready`, Grafana “Finenumbers Overview”.
6. Smoke: login → submit check → webhook delivery.
7. After risky schema changes: also take a fresh **base backup**.

## CI

GitHub Actions: `.github/workflows/ci.yml` runs lint, typecheck, test, build, and image builds. Deploy remains manual/Compose on the VPS for MVP.

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

### Web hardening

Next.js sets security headers for all routes (CSP, frame deny, nosniff, Referrer-Policy, Permissions-Policy, HSTS in prod). `connect-src` includes `PUBLIC_API_URL`.
