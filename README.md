# Finenumbers HLR Lookup Service

B2B SaaS for phone number checks (HLR + Ping-SMS) on top of [SMSC.ru](https://smsc.ru).

[![CI](https://github.com/finenumbers/hlr/actions/workflows/ci.yml/badge.svg)](https://github.com/finenumbers/hlr/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

This repository is a **pnpm + Turborepo monorepo** with NestJS API, BullMQ worker, and Next.js cabinet/admin UI.

## Structure

```text
apps/
  api/       NestJS HTTP API (+ Prisma, health, public /v1)
  worker/    BullMQ processors
  web/       Next.js admin (/admin) + client cabinet (/app)
packages/
  db/             Prisma schema, migrations, seed, client
  config/         Zod-based env loading
  contracts/      Shared response/contract types
  billing/        Ledger + tariffs
  jobs/           Async check pipeline
  webhooks/       Signed client webhook delivery
  provider-core/  Number-lookup provider port + NormalizedResult
  provider-smsc/  SMSC.ru HTTP adapter + normalizer
  ui/             Shared UI primitives
  tsconfig/       Shared TypeScript configs
infra/
  docker/    Dockerfiles + compose env template
  monitoring/Prometheus, Grafana, Loki configs
docs/        Product and operations docs
```

## Prerequisites

- Node.js >= 20
- [pnpm](https://pnpm.io/) 9.x (`corepack enable` recommended)
- Docker + Docker Compose (local data plane / full stack)

## Quick start (local apps)

```bash
cp .env.example .env
pnpm install

# data plane
docker compose up -d postgres redis

# Prisma (domain schema in packages/db)
pnpm --filter @finenumbers/db generate
pnpm --filter @finenumbers/db migrate:dev
pnpm --filter @finenumbers/db seed

# run all apps
pnpm dev
```

Individual apps:

```bash
pnpm --filter @finenumbers/api dev
pnpm --filter @finenumbers/worker dev
pnpm --filter @finenumbers/web dev
```

## Useful commands

| Command | Purpose |
|---------|---------|
| `pnpm install` | Install workspace deps |
| `pnpm dev` | Start api + worker + web via Turbo |
| `pnpm build` | Build all packages/apps |
| `pnpm typecheck` | TypeScript checks |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier write |

## Health & public API

- `GET /health/live` — process liveness
- `GET /health/ready` — Postgres + Redis readiness
- `GET /metrics` — Prometheus metrics (API); worker on `:9091/metrics`
- `GET /openapi.json` — OpenAPI contract (disabled in production by default)
- `GET /docs` — Swagger UI (disabled in production)
- Public client API: `/v1/*` (API key auth) — see [docs/public-api.md](docs/public-api.md)

## Production deploy

Canonical guide: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**

Recommended path:

1. CI publishes `:latest` images to GHCR: `ghcr.io/finenumbers/hlr-{api,worker,web}`
2. Deploy **Portainer** stack from GitHub (`main` + [`docker-compose.portainer.yml`](docker-compose.portainer.yml)) — always `latest`
3. Env: minimal set in [`infra/docker/.env.portainer.example`](infra/docker/.env.portainer.example)
4. TLS via **external Nginx Proxy Manager** (network `hlr_net` → `web:3000` / `api:3001`)

Also: [MONITORING.md](docs/MONITORING.md) · [BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md) · [RUNBOOK.md](docs/RUNBOOK.md)

```bash
# local full stack (build)
docker compose up -d --build

# same as Portainer path (always :latest)
cp infra/docker/.env.portainer.example .env
docker compose -f docker-compose.portainer.yml pull && docker compose -f docker-compose.portainer.yml up -d
```

- Admin UI: `http://localhost:3000/admin`
- Cabinet UI: `http://localhost:3000/app`

Default API port: `3001`.

## Docker Compose

Templates:

- root `.env.example` — local/dev
- `infra/docker/.env.portainer.example` — **минимальный env для Portainer** (с пояснениями)
- `infra/docker/.env.example` — расширенный compose/CLI env
- `docker-compose.portainer.yml` — **Portainer + GHCR `:latest`** (no build)
- `docker-compose.prod.yml` — localhost binds, uploads, backup profile
- `docker-compose.obs.yml` — Prometheus / Grafana / Loki / Promtail

Services (app compose):

| Service | Host port (default) |
|---------|---------------------|
| web | 3000 |
| api | 3001 |
| postgres | 5432 |
| redis | 6379 |
| worker | metrics on compose network `:9091` |

Observability ports (obs overlay): Grafana `3002`, Prometheus `9090`, Loki `3100`.

## Documentation

| File | Content |
|------|---------|
| [docs/public-api.md](docs/public-api.md) | Public `/v1` + webhook verification |
| [docs/api-outline.md](docs/api-outline.md) | API surface summary |
| [docs/architecture.md](docs/architecture.md) | Architecture notes |
| [docs/operations.md](docs/operations.md) | Ops index |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Portainer, GHCR, external NPM |
| [docs/MONITORING.md](docs/MONITORING.md) | Metrics & alerts |
| [docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md) | Backup/restore |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | Incidents |
| [docs/plan.md](docs/plan.md) | Implementation stages |
| [SECURITY.md](SECURITY.md) | Vulnerability reporting |

## License

[MIT](LICENSE) © Finenumbers
