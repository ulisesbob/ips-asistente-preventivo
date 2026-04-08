#!/bin/sh
set -e

: "${DATABASE_URL:?DATABASE_URL is required}"

echo "[Deploy] Waiting for database (Neon may need to wake up)..."
MAX_RETRIES=20
RETRY_COUNT=0

until npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma 2>&1; do
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ "$RETRY_COUNT" -ge "$MAX_RETRIES" ]; then
    echo "[Deploy] ERROR: Database not ready after $MAX_RETRIES attempts. Exiting."
    exit 1
  fi
  echo "[Deploy] DB not ready (attempt $RETRY_COUNT/$MAX_RETRIES), retrying in 10s..."
  sleep 10
done

echo "[Deploy] Migrations complete. Starting API server..."
node apps/api/dist/index.js
