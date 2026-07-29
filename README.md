# Finenumbers HLR Lookup Service

B2B SaaS for phone number checks (HLR + Ping-SMS) on top of SMSC.ru.

This repository is a **pnpm + Turborepo monorepo**. Stage 1 delivers a production-oriented infrastructure scaffold only — no product domain logic yet.

## Structure

```text
apps/
  api/       NestJS HTTP API (+ Prisma, health)
  worker/    BullMQ worker bootstrap
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
docs/        Product/implementation docs
```

## Prerequisites

- Node.js >= 20
- [pnpm](https://pnpm.io/) 9.x (`corepack enable` recommended)
- Docker + Docker Compose (for infra / full stack)

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

## Production / ops

- Deploy: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- Monitoring: [docs/MONITORING.md](docs/MONITORING.md)
- Backup/restore: [docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md)
- Runbook: [docs/RUNBOOK.md](docs/RUNBOOK.md)

```bash
# full stack
docker compose up -d --build

# + observability
docker compose -f docker-compose.yml -f docker-compose.obs.yml up -d

# production-oriented binds/secrets
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```
- Session panels: `/auth`, `/admin/*`, `/cabinet/*` — UI in [apps/web/README.md](apps/web/README.md)
  - Admin UI: `http://localhost:3000/admin`
  - Cabinet UI: `http://localhost:3000/app`

Default API port: `3001`.

## Docker Compose (full stack)

Templates:

- root `.env.example` — local/dev
- `infra/docker/.env.example` — compose-oriented defaults
- `docker-compose.obs.yml` — Prometheus / Grafana / Loki / Promtail
- `docker-compose.prod.yml` — localhost binds, uploads volume, backup profile

```bash
cp .env.example .env
# adjust secrets, then:

docker compose up -d --build
docker compose -f docker-compose.yml -f docker-compose.obs.yml up -d
```

Services (app compose):

| Service | Host port (default) |
|---------|---------------------|
| web | 3000 |
| api | 3001 |
| postgres | 5432 |
| redis | 6379 |
| worker | metrics on compose network `:9091` |

Observability ports (obs overlay): Grafana `3002`, Prometheus `9090`, Loki `3100`.

Infra-only:

```bash
docker compose up -d postgres redis
```

## Documentation

| File | Content |
|------|---------|
| [docs/plan.md](docs/plan.md) | Implementation stages |
| [docs/todos.md](docs/todos.md) | Task checklist |
| [docs/public-api.md](docs/public-api.md) | Public `/v1` + webhook verification |
| [docs/api-outline.md](docs/api-outline.md) | API surface summary |
| [docs/architecture.md](docs/architecture.md) | Architecture notes |
| [docs/operations.md](docs/operations.md) | Ops index |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Prod deploy / NPM |
| [docs/MONITORING.md](docs/MONITORING.md) | Metrics & alerts |
| [docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md) | Backup/restore |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | Incidents |
