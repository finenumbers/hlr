#!/bin/sh
# Snapshot Redis persistence files (RDB + AOF) after BGSAVE.
# Redis is NOT the ledger — use this for queue continuity, not billing recovery.
#
# Example:
#   REDIS_CONTAINER=$(docker compose ps -q redis) \
#   BACKUP_DIR=./backups/redis \
#     ./infra/scripts/backup-redis.sh

set -eu

REDIS_CONTAINER="${REDIS_CONTAINER:-}"
BACKUP_DIR="${BACKUP_DIR:-./backups/redis}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${BACKUP_DIR}/${STAMP}"

if [ -z "${REDIS_CONTAINER}" ]; then
  echo "Set REDIS_CONTAINER to the running redis container id/name." >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"

echo "[redis-backup] BGSAVE in ${REDIS_CONTAINER}"
BEFORE="$(docker exec "${REDIS_CONTAINER}" redis-cli LASTSAVE | tr -d '\r')"
docker exec "${REDIS_CONTAINER}" redis-cli BGSAVE >/dev/null

# Wait until LASTSAVE advances (max ~60s).
i=0
while [ "$i" -lt 60 ]; do
  NOW="$(docker exec "${REDIS_CONTAINER}" redis-cli LASTSAVE | tr -d '\r')"
  if [ "${NOW}" != "${BEFORE}" ]; then
    break
  fi
  i=$((i + 1))
  sleep 1
done

docker cp "${REDIS_CONTAINER}:/data/dump.rdb" "${OUT_DIR}/dump.rdb"
# AOF may be a directory (Redis 7 multipart) or a single file.
if docker exec "${REDIS_CONTAINER}" sh -c 'test -d /data/appendonlydir'; then
  docker cp "${REDIS_CONTAINER}:/data/appendonlydir" "${OUT_DIR}/appendonlydir"
elif docker exec "${REDIS_CONTAINER}" sh -c 'test -f /data/appendonly.aof'; then
  docker cp "${REDIS_CONTAINER}:/data/appendonly.aof" "${OUT_DIR}/appendonly.aof"
fi

if command -v sha256sum >/dev/null 2>&1; then
  (cd "${OUT_DIR}" && find . -type f -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
fi

ln -sfn "${STAMP}" "${BACKUP_DIR}/latest"
echo "[redis-backup] done: ${OUT_DIR}"
ls -lah "${OUT_DIR}" || true
