# Operations — Finenumbers

Канон: [plan.md](./plan.md).

**Production docs (E16/E17):**

- [DEPLOYMENT.md](./DEPLOYMENT.md) — Compose, NPM, migrations, safe deploy  
- [MONITORING.md](./MONITORING.md) — metrics, Grafana, alerts, logs  
- [BACKUP_RESTORE.md](./BACKUP_RESTORE.md) — Postgres logical + WAL/PITR, Redis AOF/RDB, restore drills  
- [RUNBOOK.md](./RUNBOOK.md) — incidents & pilot checklist  

---

## Local development

1. `pnpm install`  
2. `docker compose up -d postgres redis`  
3. Скопировать `.env.example` → `.env`, заполнить secrets  
4. `pnpm --filter @finenumbers/db prisma migrate dev`  
5. `pnpm --filter @finenumbers/db prisma db seed`  
6. `pnpm dev` (api / worker / web)  

---

## Env vs Admin

**Только `.env`:** `DATABASE_URL`, `REDIS_URL`, `API_KEY_PEPPER`, URL’ы, `TRUST_PROXY`, `CORS_ORIGINS`, `SMSC_*`, body/timeout/RPM hardening, metrics flags.

**Админка (PlatformSettings):** RPM/CSV limits, timeouts, poll, webhook retries, retention, currency, `smscBaseUrl`, extras.

SMSC credentials **никогда** не редактируются из UI.

---

## Docker

```bash
# App
docker compose up -d --build

# App + observability
docker compose -f docker-compose.yml -f docker-compose.obs.yml up -d --build

# Production-oriented binds + secrets
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Services: `postgres`, `redis` (AOF), `api`, `worker`, `web`.  
Obs overlay: `prometheus`, `loki`, `promtail`, `grafana`.

---

## External Nginx Proxy Manager

NPM **не** входит в compose. См. [DEPLOYMENT.md](./DEPLOYMENT.md).

| Host | Upstream |
|------|----------|
| `app.example.com` | `127.0.0.1:3000` (web) |
| `api.example.com` | `127.0.0.1:3001` (api) |

Обязательно: TLS, `X-Forwarded-*`, `TRUST_PROXY=true` на API.

### SMSC callback

`https://api.example.com/internal/smsc/callback` (+ `SMSC_CALLBACK_SECRET`).

---

## Observability

См. [MONITORING.md](./MONITORING.md).

- Metrics: api `/metrics`, worker `:9091/metrics`  
- Logs: JSON → Promtail → Loki (телефоны маскируются)  
- Grafana: Finenumbers Overview  

---

## Pilot checklist

1. Login admin / cabinet  
2. Создать tariff  
3. Создать org + user + topup + limits  
4. Создать API key  
5. `POST /v1/checks` → poll / webhook  
6. Проверить Grafana + отсутствие critical alerts  
