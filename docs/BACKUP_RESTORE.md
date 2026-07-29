# Backup & restore

Postgres is the **source of truth** (tenants, billing, jobs, webhooks, audit).  
Redis holds BullMQ queues and rate-limit counters — useful for continuity, **not** for ledger integrity.

## Strategy overview (VPS / Docker Compose)

| Layer | What | Cadence | Typical RPO |
|-------|------|---------|-------------|
| Postgres **logical** | `pg_dump --format=custom` | Daily + before every prod deploy | ≤ dump interval (e.g. 24h) |
| Postgres **WAL archive** | `archive_mode=on` → volume `postgres_wal_archive` | Continuous (`archive_timeout=60s`) | ~1–2 minutes |
| Postgres **base backup** | `pg_basebackup` (tar) | Weekly (or daily) | PITR when combined with WAL |
| Redis | AOF `everysec` + RDB `save` | Continuous + optional snapshot copy | Seconds–minutes of queue state |
| Offsite | Copy `backup_data` + WAL archive off-box | After each backup | Same as above once copied |

**Default incident path:** restore latest **logical** dump (fastest, most practiced).  
**Tight RPO / “restore to 14:37”:** **base backup + WAL** (PITR).  
**Do not** treat Redis restore as billing recovery.

Compose already enables WAL archiving and Redis persistence. Scripts live in `infra/scripts/`.

---

## Postgres — backup

### A) Logical dump (daily)

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile backup run --rm postgres-backup
```

Writes: volume `backup_data` → `/backups/logical/<db>_<stamp>.dump` (+ `.sha256`).

Host equivalent:

```bash
export PGHOST=127.0.0.1 PGUSER=finenumbers PGPASSWORD=... PGDATABASE=finenumbers
BACKUP_DIR=./backups/logical ./infra/scripts/backup-postgres.sh
```

### B) WAL archive (continuous)

Configured on the `postgres` service:

- `wal_level=replica`
- `archive_mode=on`
- `archive_command=cp` into `/wal_archive`
- `archive_timeout=60`
- Volume: `postgres_wal_archive`

Verify archive is filling:

```bash
docker compose exec postgres sh -c 'ls -lt /wal_archive | head'
```

**Offsite:** periodically `docker run --rm -v finenumbers_postgres_wal_archive:/wal -v "$PWD/backups/wal:/out" alpine cp -a /wal/. /out/` (or rsync the bind-mounted copy). Without offsite WAL, disk loss of the VPS still loses PITR.

### C) Physical base backup (for PITR)

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile backup run --rm postgres-basebackup
```

Writes: `/backups/base/<stamp>/base.tar.gz` (+ `latest/`).

### Suggested cron (host)

```cron
# Logical dump every day 02:15 UTC
15 2 * * * cd /opt/finenumbers && docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile backup run --rm postgres-backup

# Base backup weekly Sunday 03:00 UTC
0 3 * * 0 cd /opt/finenumbers && docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile backup run --rm postgres-basebackup

# Offsite sync (example)
30 3 * * * rsync -a /var/lib/docker/volumes/finenumbers_backup_data/_data/ backup@offsite:/finenumbers/backup_data/
40 3 * * * rsync -a /var/lib/docker/volumes/finenumbers_postgres_wal_archive/_data/ backup@offsite:/finenumbers/wal_archive/
```

---

## Postgres — restore

### Path 1: Logical restore (usual)

Use when: corruption, bad migration, “yesterday was fine”, most outages.

1. **Stop writers**

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop api worker
```

2. **Restore dump** (from host with `psql`/`pg_restore`, or a one-shot client container):

```bash
export PGHOST=127.0.0.1 PGUSER=finenumbers PGPASSWORD=... PGDATABASE=finenumbers
./infra/scripts/restore-postgres.sh ./backups/logical/finenumbers_YYYYMMDDThhmmssZ.dump
```

Compose one-shot variant:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm \
  -v "$(pwd)/backups/logical:/dumps:ro" \
  -e PGHOST=postgres -e PGUSER=finenumbers -e PGPASSWORD -e PGDATABASE=finenumbers \
  postgres-backup \
  /bin/sh -c 'apk add --no-cache bash >/dev/null; /scripts/restore-postgres.sh /dumps/YOUR.dump'
```

(`postgres-backup` image already has client tools; override entrypoint if needed:)

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm --entrypoint /bin/sh \
  -v "$(pwd)/backups/logical:/dumps:ro" \
  -e PGHOST=postgres -e PGUSER=finenumbers -e PGPASSWORD -e PGDATABASE=finenumbers \
  postgres-backup \
  -c '/scripts/restore-postgres.sh /dumps/YOUR.dump'
```

3. **Migrations newer than the dump**

```bash
pnpm --filter @finenumbers/db prisma migrate deploy
```

4. **Start worker → api**, verify

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml start worker api
curl -sf "$PUBLIC_API_URL/health/ready"
# Spot-check a known tenant wallet balance in admin/cabinet
```

5. Redis: usually **skip** restore (queues rebuild / reconciliation). Only restore Redis if you need the exact pre-incident queue state.

### Path 2: PITR — base + WAL

Use when: need a point-in-time before a destructive write, and WAL archive + base backup are available.

1. Stop the stack:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop api worker web postgres
```

2. Prepare recovery files on the host:

```bash
# Copy WAL volume out once if you only have the Docker volume:
docker run --rm -v finenumbers_postgres_wal_archive:/wal -v "$PWD/backups/wal_archive:/out" alpine \
  sh -c 'cp -a /wal/. /out/'

BASE_DIR=./backups/base/<stamp> \
WAL_ARCHIVE_DIR=./backups/wal_archive \
RECOVERY_TARGET_TIME='2026-01-01 12:00:00+00' \
RECOVERY_WORK_DIR=./backups/recovery_work \
  ./infra/scripts/restore-postgres-pitr.sh
```

Omit `RECOVERY_TARGET_TIME` to recover to the end of available WAL.

3. Replace `postgres_data` with prepared `pgdata` (destructive):

```bash
# Backup current volume name first if unsure.
docker volume create finenumbers_postgres_data_old || true

docker run --rm \
  -v finenumbers_postgres_data:/data \
  -v "$PWD/backups/recovery_work/pgdata:/src:ro" \
  alpine sh -c 'rm -rf /data/* /data/.[!.]*; cp -a /src/. /data/'

# Refresh WAL archive volume used by compose (/wal_archive)
docker run --rm \
  -v finenumbers_postgres_wal_archive:/wal \
  -v "$PWD/backups/recovery_work/wal_archive:/src:ro" \
  alpine sh -c 'rm -rf /wal/*; cp -a /src/. /wal/'
```

Adjust volume names if `COMPOSE_PROJECT_NAME` differs (`docker volume ls | grep postgres`).

4. Start Postgres and watch recovery:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml start postgres
docker compose logs -f postgres
# Wait until recovery completes / database accepts connections
```

5. Migrate (if needed), start apps, verify (same as logical path steps 3–4).

6. After successful promote, take a **fresh logical dump** and a **new base backup** so the next recovery starts clean.

---

## Redis — persistence & restore

### Persistence (enabled in compose)

`infra/redis/redis.conf`:

- AOF on, `appendfsync everysec`
- RDB `save 60 1000` and `save 300 100`
- `maxmemory-policy noeviction` (BullMQ safety)

### Snapshot backup

```bash
REDIS_CONTAINER=$(docker compose ps -q redis) \
BACKUP_DIR=./backups/redis \
  ./infra/scripts/backup-redis.sh
```

### Restore Redis

```bash
docker compose stop api worker
REDIS_CONTAINER=$(docker compose ps -q redis) \
SNAPSHOT_DIR=./backups/redis/<stamp> \
  ./infra/scripts/restore-redis.sh
docker compose start worker api
```

After Redis-only loss **without** restore: RPM windows reset; in-flight BullMQ jobs may need the worker reconciliation tick + stuck-job review. **Wallets/jobs in Postgres remain authoritative.**

---

## Uploads volume

Prod overlay mounts `uploads_data` at `/data/uploads`. Include that volume in filesystem/offsite backups if CSV uploads are used.

---

## Drill checklist (do this before you need it)

1. Take a logical dump on staging.  
2. Restore it to a throwaway DB.  
3. Confirm `/health/ready` + one tenant balance.  
4. Once: practice PITR prepare script on staging with a short `RECOVERY_TARGET_TIME`.  
5. Confirm WAL archive directory grows on the live VPS.  
6. Confirm Redis AOF/RDB files exist under the redis volume.

---

## What not to do

- Rely on a random `./backup` folder without checksums or offsite copy.  
- `pg_restore` into a live busy DB without stopping api/worker.  
- Treat Redis as a billing backup.  
- Assume WAL archive on the same disk is enough for disk failure — **copy off-box**.  
- Skip taking a new base backup after a PITR promote.
