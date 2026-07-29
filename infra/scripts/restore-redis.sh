#!/bin/sh
# Restore Redis from a backup-redis.sh snapshot directory.
#
# DANGER: replaces Redis data. Stop api/worker first (they hold Redis connections).
#
# Example:
#   docker compose stop api worker
#   REDIS_CONTAINER=$(docker compose ps -q redis) \
#   SNAPSHOT_DIR=./backups/redis/20260101T000000Z \
#     ./infra/scripts/restore-redis.sh
#   docker compose restart redis
#   docker compose start worker api

set -eu

REDIS_CONTAINER="${REDIS_CONTAINER:-}"
SNAPSHOT_DIR="${SNAPSHOT_DIR:-${1:-}}"

if [ -z "${REDIS_CONTAINER}" ]; then
  echo "Set REDIS_CONTAINER to the redis container id/name." >&2
  exit 1
fi
if [ -z "${SNAPSHOT_DIR}" ] || [ ! -d "${SNAPSHOT_DIR}" ]; then
  echo "Usage: SNAPSHOT_DIR=./backups/redis/<stamp> $0" >&2
  echo "   or: $0 ./backups/redis/<stamp>" >&2
  exit 1
fi

echo "[redis-restore] stopping redis writes via SHUTDOWN NOSAVE is unsafe here;"
echo "[redis-restore] prefer: docker compose stop api worker && docker compose stop redis"
echo "[redis-restore] copying snapshot from ${SNAPSHOT_DIR}"

# Start redis if needed only for docker cp into the volume — better copy via stopped volume.
# We copy into the container filesystem while redis is stopped using a helper:
# docker compose stop redis; docker cp into the volume via a temp container.

COMPOSE_PROJECT="${COMPOSE_PROJECT_NAME:-finenumbers}"
VOLUME_NAME="${REDIS_VOLUME:-${COMPOSE_PROJECT}_redis_data}"

echo "[redis-restore] using volume ${VOLUME_NAME}"
docker compose stop redis 2>/dev/null || docker stop "${REDIS_CONTAINER}" 2>/dev/null || true

# Clear and restore via alpine helper mounted to the volume.
docker run --rm \
  -v "${VOLUME_NAME}:/data" \
  -v "$(cd "${SNAPSHOT_DIR}" && pwd):/snapshot:ro" \
  alpine:3.21 \
  sh -c '
    set -eu
    rm -rf /data/*
    if [ -f /snapshot/dump.rdb ]; then
      cp /snapshot/dump.rdb /data/dump.rdb
    fi
    if [ -d /snapshot/appendonlydir ]; then
      cp -a /snapshot/appendonlydir /data/appendonlydir
    elif [ -f /snapshot/appendonly.aof ]; then
      cp /snapshot/appendonly.aof /data/appendonly.aof
    fi
    ls -lah /data
  '

echo "[redis-restore] starting redis"
docker compose start redis 2>/dev/null || docker start "${REDIS_CONTAINER}"

echo "[redis-restore] ping"
docker compose exec redis redis-cli ping 2>/dev/null \
  || docker exec "${REDIS_CONTAINER}" redis-cli ping

echo "[redis-restore] complete. Start worker then api."
echo "Note: BullMQ may need reconciliation; Postgres remains source of truth for jobs/billing."
