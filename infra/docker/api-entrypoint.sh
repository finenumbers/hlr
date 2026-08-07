#!/bin/sh
# Ensure CSV upload volume is writable by nestjs (uid 1001) before drop privileges.
set -eu

UPLOAD_DIR="${UPLOAD_DIR:-/data/uploads}"
mkdir -p "${UPLOAD_DIR}/.tmp"

if [ "$(id -u)" = "0" ]; then
  chown -R nestjs:nestjs "${UPLOAD_DIR}" || true
  exec gosu nestjs "$@"
fi

exec "$@"
