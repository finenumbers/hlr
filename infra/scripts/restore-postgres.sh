#!/bin/sh
# Restore a logical custom-format dump from backup-postgres.sh.
#
# DANGER: --clean drops/recreates objects in the target database.
# Always stop API + worker writers first.
#
# Example:
#   docker compose stop api worker
#   PGHOST=127.0.0.1 PGUSER=finenumbers PGPASSWORD=... PGDATABASE=finenumbers \
#     ./infra/scripts/restore-postgres.sh ./backups/logical/finenumbers_20260101T000000Z.dump
#   pnpm --filter @finenumbers/db prisma migrate deploy
#   docker compose start worker api

set -eu

DUMP_FILE="${1:-}"
if [ -z "${DUMP_FILE}" ] || [ ! -f "${DUMP_FILE}" ]; then
  echo "Usage: $0 /path/to/backup.dump" >&2
  exit 1
fi

PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-finenumbers}"
PGDATABASE="${PGDATABASE:-finenumbers}"
PGPORT="${PGPORT:-5432}"

echo "[restore-logical] target ${PGUSER}@${PGHOST}:${PGPORT}/${PGDATABASE}"
echo "[restore-logical] source  ${DUMP_FILE}"

if [ -f "${DUMP_FILE}.sha256" ]; then
  echo "[restore-logical] verifying checksum"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "${DUMP_FILE}.sha256"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -c "${DUMP_FILE}.sha256"
  fi
fi

# Ensure DB exists (no-op if already there).
psql -v ON_ERROR_STOP=1 -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d postgres \
  -tc "SELECT 1 FROM pg_database WHERE datname='${PGDATABASE}'" | grep -q 1 \
  || psql -v ON_ERROR_STOP=1 -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d postgres \
    -c "CREATE DATABASE \"${PGDATABASE}\""

echo "[restore-logical] terminating other sessions (best-effort)"
psql -v ON_ERROR_STOP=0 -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d postgres <<SQL
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = '${PGDATABASE}' AND pid <> pg_backend_pid();
SQL

echo "[restore-logical] pg_restore --clean --if-exists"
pg_restore \
  --host="${PGHOST}" \
  --port="${PGPORT}" \
  --username="${PGUSER}" \
  --dbname="${PGDATABASE}" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --verbose \
  "${DUMP_FILE}"

echo "[restore-logical] complete."
echo "Next:"
echo "  1) pnpm --filter @finenumbers/db prisma migrate deploy"
echo "  2) start worker, then api"
echo "  3) curl -sf \$PUBLIC_API_URL/health/ready"
echo "  4) spot-check a known tenant wallet balance"
echo "For point-in-time recovery see restore-postgres-pitr.sh / docs/BACKUP_RESTORE.md"
