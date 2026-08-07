#!/bin/sh
# Shared uploads_data volume: worker uid 1001 must read/write tenant files + .tmp.
set -eu

UPLOAD_DIR="${UPLOAD_DIR:-/data/uploads}"
mkdir -p "${UPLOAD_DIR}/.tmp"

if [ "$(id -u)" = "0" ]; then
  chown -R worker:worker "${UPLOAD_DIR}" || true
  exec gosu worker "$@"
fi

exec "$@"
