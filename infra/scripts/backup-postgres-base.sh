#!/bin/sh
# Physical base backup via pg_basebackup (tar). Use with continuous WAL archive for PITR.
#
# Compose:
#   docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile backup run --rm postgres-basebackup
#
# Produces: /backups/base/base_YYYYmmddThhmmssZ.tar.gz
# Restore procedure: docs/BACKUP_RESTORE.md → "Postgres PITR (base + WAL)"

set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups/base}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${BACKUP_DIR}/${STAMP}"
PGHOST="${PGHOST:-postgres}"
PGUSER="${PGUSER:-finenumbers}"
PGPORT="${PGPORT:-5432}"

mkdir -p "${OUT_DIR}"

echo "[backup-base] pg_basebackup → ${OUT_DIR}"
# -X none: rely on archive_command WAL files for PITR (already streaming to /wal_archive).
# -Ft -z: tar + gzip of the data directory.
pg_basebackup \
  -h "${PGHOST}" \
  -p "${PGPORT}" \
  -U "${PGUSER}" \
  -D "${OUT_DIR}" \
  -Ft \
  -z \
  -P \
  -X none \
  -c fast

# Convenience single-file pointer for operators.
LATEST="${BACKUP_DIR}/latest"
rm -rf "${LATEST}"
mkdir -p "${LATEST}"
# shellcheck disable=SC2086
cp -a ${OUT_DIR}/* "${LATEST}/"

if command -v sha256sum >/dev/null 2>&1; then
  (cd "${OUT_DIR}" && sha256sum ./* > SHA256SUMS)
elif command -v shasum >/dev/null 2>&1; then
  (cd "${OUT_DIR}" && shasum -a 256 ./* > SHA256SUMS)
fi

echo "[backup-base] pruning base backups older than ${KEEP_DAYS} days"
find "${BACKUP_DIR}" -mindepth 1 -maxdepth 1 -type d ! -name latest -mtime "+${KEEP_DAYS}" -print -exec rm -rf {} + || true

echo "[backup-base] done: ${OUT_DIR}"
ls -lh "${OUT_DIR}" || true
