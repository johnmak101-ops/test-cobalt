#!/bin/sh
set -e

# Optional one-time DB setup, controlled by compose env so re-runs are cheap:
#   RUN_MIGRATIONS=1  -> apply the committed Drizzle migrations (non-interactive; idempotent)
#   SEED_ON_START=1   -> load the demo seed (users admin@cobalt.hk/cobalt, sample data)
# Use `migrate` (applies backend/drizzle/*.sql) — NOT `push`, which needs a TTY prompt.
if [ "$RUN_MIGRATIONS" = "1" ]; then
  echo "[entrypoint] applying migrations (drizzle-kit migrate) against $DATABASE_URL ..."
  pnpm --filter backend exec drizzle-kit migrate || echo "[entrypoint] WARN: migrate failed"
fi

if [ "$SEED_ON_START" = "1" ]; then
  echo "[entrypoint] seeding demo data ..."
  pnpm --filter backend seed || echo "[entrypoint] WARN: seed failed (already seeded?)"
fi

echo "[entrypoint] starting: $*"
exec "$@"
