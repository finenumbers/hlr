# Operations — Finenumbers

Канон: [plan.md](./plan.md).

**Production docs (E16/E17):**

- [DEPLOYMENT.md](./DEPLOYMENT.md) — Portainer, GHCR, external NPM, migrations, safe deploy  
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

Production: Portainer stack [`docker-compose.portainer.yml`](../docker-compose.portainer.yml) (всегда `:latest` + `main`) + external NPM в сети **`proxy`** — see [DEPLOYMENT.md](./DEPLOYMENT.md). Env: [`infra/docker/.env.portainer.example`](../infra/docker/.env.portainer.example). Перед деплоем: `docker network create proxy` (если сети ещё нет).

```bash
# App (local build)
docker compose up -d --build

# App (как Portainer: всегда :latest)
docker compose -f docker-compose.portainer.yml pull
docker compose -f docker-compose.portainer.yml up -d

# App + observability
docker compose -f docker-compose.yml -f docker-compose.obs.yml up -d
```

Services: `postgres`, `redis` (AOF), `api`, `worker`, `web`.  
Obs overlay: `prometheus`, `loki`, `promtail`, `grafana`.

---

## External Nginx Proxy Manager

NPM **не** входит в compose. См. [DEPLOYMENT.md](./DEPLOYMENT.md).

| Host | Upstream (сеть `proxy`) | Fallback (same host) |
|------|-------------------------|----------------------|
| `app.example.com` | `http://web:3000` | `127.0.0.1:3000` |
| `api.example.com` | `http://api:3001` | `127.0.0.1:3001` |

Обязательно: TLS, `X-Forwarded-*`. NPM и сервисы `api`/`web` в Docker-сети **`proxy`**.

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
