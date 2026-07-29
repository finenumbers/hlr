#!/bin/sh
# Logical Postgres backup (custom format). Safe while the DB is online.
#
# Compose:
#   docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile backup run --rm postgres-backup
# Host:
#   PGHOST=127.0.0.1 PGUSER=finenumbers PGPASSWORD=... PGDATABASE=finenumbers \
#     BACKUP_DIR=./backups/postgres ./infra/scripts/backup-postgres.sh
#
# Pair with WAL archiving (see BACKUP_RESTORE.md) for tighter RPO.
# This dump alone ≈ RPO up to your dump interval (daily by default).

set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups/logical}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DB_NAME="${PGDATABASE:-finenumbers}"
FILE="${BACKUP_DIR}/${DB_NAME}_${STAMP}.dump"

mkdir -p "${BACKUP_DIR}"

echo "[backup-logical] starting ${FILE}"
pg_dump \
  --format=custom \
  --no-owner \
  --no-acl \
  --verbose \
  --file="${FILE}"

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "${FILE}" > "${FILE}.sha256"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "${FILE}" > "${FILE}.sha256"
fi

echo "[backup-logical] pruning dumps older than ${KEEP_DAYS} days"
find "${BACKUP_DIR}" -type f \( -name '*.dump' -o -name '*.dump.sha256' \) -mtime "+${KEEP_DAYS}" -print -delete || true

SIZE="$(wc -c < "${FILE}" | tr -d ' ')"
echo "[backup-logical] done: ${FILE} (${SIZE} bytes)"
ls -lh "${FILE}" "${FILE}.sha256" 2>/dev/null || true
