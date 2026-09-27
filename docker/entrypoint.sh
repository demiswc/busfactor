#!/bin/sh
# Creates/updates the database tables, then starts the web app.
set -e
if [ "${SKIP_DB_PUSH:-0}" != "1" ]; then
  npx prisma db push
fi
exec npx next start -H 0.0.0.0 -p "${PORT:-3000}"
