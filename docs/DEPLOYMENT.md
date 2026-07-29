# Deployment

Related: [MONITORING.md](./MONITORING.md), [BACKUP_RESTORE.md](./BACKUP_RESTORE.md), [RUNBOOK.md](./RUNBOOK.md), [operations.md](./operations.md).

## Target topology (MVP)

| Layer | Role |
|-------|------|
| **Portainer** (or Compose CLI) | Deploy/update the app stack from GHCR |
| **App stack** | `postgres`, `redis`, `api`, `worker`, `web` |
| **External Nginx Proxy Manager** | TLS termination + host routing (separate from this stack) |

No Kubernetes required. App containers publish only to `127.0.0.1` (or stay on Docker network `hlr_net` for NPM).

| Service | Role | Reachability |
|---------|------|----------------|
| `postgres` | Primary data | `127.0.0.1:5432` (+ compose network) |
| `redis` | BullMQ + rate limits (AOF) | `127.0.0.1:6379` |
| `api` | NestJS HTTP | `127.0.0.1:3001` or `http://api:3001` on `hlr_net` |
| `worker` | BullMQ + `/metrics:9091` | compose network only |
| `web` | Next.js UI | `127.0.0.1:3000` or `http://web:3000` on `hlr_net` |
| obs (optional) | Prometheus / Grafana / Loki | see `docker-compose.obs.yml` |

## Container images (GHCR)

CI publishes on push to `main` / tags `v*`:

| Image | Tags |
|-------|------|
| `ghcr.io/finenumbers/hlr-api` | `latest`, `sha-<short>`, semver |
| `ghcr.io/finenumbers/hlr-worker` | same |
| `ghcr.io/finenumbers/hlr-web` | same |

Packages are **public** so Portainer/VPS can pull without a registry login. Pin production with `IMAGE_TAG=sha-…` or a semver tag.

## Prerequisites

1. Docker + Compose v2 (or Portainer with Compose stacks).
2. External **Nginx Proxy Manager** already running (TLS certificates, DNS).
3. Env secrets: strong `API_KEY_PEPPER`, `POSTGRES_PASSWORD`, public HTTPS URLs, SMSC credentials.
4. Public hostnames for web + API; SMSC callback URL reachable from the internet.

## Env hardening (production)

Required:

- `NODE_ENV=production`
- `API_KEY_PEPPER` ≠ default
- `PUBLIC_API_URL` / `PUBLIC_WEB_URL` = public HTTPS URLs
- `TRUST_PROXY=true` (behind NPM)
- `CORS_ORIGINS` = cabinet origin(s), comma-separated
- SMSC credentials (`SMSC_LOGIN`/`SMSC_PASSWORD` or `SMSC_API_KEY`)
- `IMAGE_TAG` — prefer immutable `sha-…` in production

Never commit secrets. Prefer Portainer stack env / host `.env`; compose reads `${VAR}`.

Template: [`infra/docker/.env.example`](../infra/docker/.env.example).

---

## Deploy with Portainer (recommended)

### 1. Create the stack

Portainer → **Stacks** → **Add stack**:

**Option A — from Git (preferred)**

- Repository URL: `https://github.com/finenumbers/hlr`
- Compose path: `docker-compose.portainer.yml`
- Branch: `main`
- Enable auto-update if you want Portainer to redeploy when the compose file changes (images still controlled by `IMAGE_TAG`)

**Option B — web editor**

- Paste contents of [`docker-compose.portainer.yml`](../docker-compose.portainer.yml)

### 2. Stack environment

Set at least:

```env
IMAGE_TAG=latest
POSTGRES_PASSWORD=<strong>
API_KEY_PEPPER=<long-random>
PUBLIC_API_URL=https://api.example.com
PUBLIC_WEB_URL=https://app.example.com
CORS_ORIGINS=https://app.example.com
TRUST_PROXY=true
SMSC_LOGIN=
SMSC_PASSWORD=
SMSC_API_KEY=
SMSC_CALLBACK_SECRET=
```

Deploy the stack. Network `hlr_net` is created automatically.

### 3. Migrations (first boot / after schema changes)

From Portainer → stack → `api` container → **Console**, or any host with DB access:

```bash
# On a machine with the repo + network access to Postgres:
export DATABASE_URL=postgresql://finenumbers:...@127.0.0.1:5432/finenumbers?schema=public
pnpm --filter @finenumbers/db prisma migrate deploy
pnpm --filter @finenumbers/db prisma db seed   # first boot only
```

Alternatively run migrate from a one-off container that has the image and `DATABASE_URL` pointing at `postgres` on `hlr_net`.

### 4. Update / rollback

1. Set `IMAGE_TAG` to the new `sha-…` or semver (or `latest`).
2. Portainer → stack → **Pull and redeploy** (or Update the stack).
3. Order of healthy restart: `worker` → `api` → `web`.
4. Verify `/health/live`, `/health/ready`, smoke login + check.

---

## External Nginx Proxy Manager

NPM is **not** part of this compose file. It terminates TLS and forwards to the app.

### Recommended: join Docker network `hlr_net`

1. In Portainer (or `docker network connect`), attach the NPM container to network **`hlr_net`**.
2. Create Proxy Hosts:

| Domain | Scheme | Forward hostname | Forward port | Notes |
|--------|--------|------------------|--------------|--------|
| `app.example.com` | `http` | `web` | `3000` | Websockets on if needed |
| `api.example.com` | `http` | `api` | `3001` | Public API + health + SMSC callback |

3. Enable SSL (Let's Encrypt) on both hosts.
4. Always pass / preserve:

- `X-Forwarded-For`
- `X-Forwarded-Proto`
- `X-Forwarded-Host` / `Host`

API must run with `TRUST_PROXY=true` so `req.ip` and rate limits see the client IP.

```text
Internet → NPM (TLS) ──hlr_net──► web:3000
                     └──────────► api:3001
```

### Fallback: host ports (NPM not on `hlr_net`)

If NPM cannot join `hlr_net` but runs on the **same Docker host**, forward to:

| Domain | Forward to |
|--------|------------|
| `app.example.com` | `127.0.0.1` : `3000` (or host gateway IP if NPM is containerized without host network) |
| `api.example.com` | `127.0.0.1` : `3001` |

Portainer stack publishes API/Web only on `127.0.0.1` by default (not the public interface).

### SMSC callback

Configure in SMSC cabinet:

`https://api.example.com/internal/smsc/callback`

Accepts POST (body/query) and GET (query). Signature: md5/sha1 of `id:phone:status:<SMSC_CALLBACK_SECRET>` (fields in payload or `X-SMSC-MD5` / `X-SMSC-SHA1` headers).

---

## Deploy with Compose CLI (alternative)

```bash
cp infra/docker/.env.example .env
# edit secrets + IMAGE_TAG

docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Local build fallback (no GHCR):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Migrations (host with repo checkout):

```bash
export DATABASE_URL=postgresql://...@127.0.0.1:5432/finenumbers?schema=public
pnpm --filter @finenumbers/db prisma migrate deploy
pnpm --filter @finenumbers/db prisma db seed   # first boot only
```

Observability overlay:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.obs.yml up -d
```

---

## Safe deploy sequence

1. Take Postgres **logical** dump (+ confirm WAL archive is advancing); see [BACKUP_RESTORE.md](./BACKUP_RESTORE.md).
2. Pull new images (`IMAGE_TAG`) via Portainer or `docker compose pull`.
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

### Web hardening

Next.js sets security headers for all routes (CSP, frame deny, nosniff, Referrer-Policy, Permissions-Policy, HSTS in prod). `connect-src` includes `PUBLIC_API_URL`.
