#!/bin/sh
# Run inside hlr-api image (Portainer init / one-shot).
set -eu

cd /app/packages/db

echo ">> prisma migrate deploy"
npx --yes prisma migrate deploy

echo ">> prisma seed"
npx --yes tsx prisma/seed.ts

echo ">> migrate-and-seed done"
