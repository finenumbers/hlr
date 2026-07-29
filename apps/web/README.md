# Finenumbers Web — Admin + Client Cabinet

Production-oriented Next.js UI for platform operators and tenant users.

## Structure

```text
src/
  app/
    admin/          # /admin — platform panel
      login/
      (panel)/      # guarded shell: dashboard, tenants, jobs, billing, monitoring, audit
    app/            # /app — client cabinet
      login/
      (panel)/      # guarded shell: dashboard, submit, jobs, billing, api-keys, webhooks, settings
  components/
    ui/             # Button, Input, Dialog, Badge, Card
    data/           # DataTable, MetricCard, QueryState, PageHeader
    auth/           # RequireAuth, RequirePermission, Can
    layout/         # AppShell
  lib/
    api/client.ts   # typed fetch client for /auth, /admin, /cabinet
    auth/           # AuthProvider + permission matrix
```

## Routing

| Area | Base | Purpose |
|------|------|---------|
| Admin | `/admin` | Internal ops (tenants, jobs, money, monitoring, audit) |
| Cabinet | `/app` | Tenant self-serve (submit, jobs, billing, keys, webhooks) |

Root `/` redirects to `/app`.

## Roles & RBAC

Permissions live in `src/lib/auth/permissions.ts`. **API is the source of truth**; UI uses the same matrix for nav, route guards, and action buttons.

| Role | Area |
|------|------|
| `SUPERADMIN` | Full admin, including top-up/adjust/status/tariff |
| `SUPPORT` | Admin read/ops; money & tenant write denied (API 403) |
| `OWNER` / `ADMIN` | Cabinet + manage API keys & webhooks |
| `MEMBER` | Cabinet submit/jobs/billing read; key/webhook mutate denied |

Layers:

1. Area guard (`RequireAuth`) — wrong area → access denied / login redirect  
2. `RequirePermission` / `Can` — deep links & buttons  
3. Nest `@Roles` on `/admin/*` and `/cabinet/*`

## Data fetching

- TanStack Query for lists/details/mutations  
- `api` client sends `Authorization: Bearer <session>` and `X-Tenant-Id` for cabinet  
- Session from `POST /auth/login` (opaque token in `localStorage`)

Backend BFF (not public `/v1`):

- `/admin/*` — platform  
- `/cabinet/*` — tenant-scoped  

## Local run

```bash
# from repo root
cp apps/web/.env.example apps/web/.env.local   # NEXT_PUBLIC_API_URL=http://localhost:3001
pnpm --filter @finenumbers/api dev
pnpm --filter @finenumbers/web dev
```

Seed login (after `pnpm --filter @finenumbers/db seed` — no demo clients):

- Admin: `admin@finenumbers.local` / `ChangeMeNow!` → `/admin/login`
- Cabinet users: create a tenant + membership in admin, then `/app/login`

## Scripts

```bash
pnpm --filter @finenumbers/web typecheck
pnpm --filter @finenumbers/web lint
pnpm --filter @finenumbers/web build
```
