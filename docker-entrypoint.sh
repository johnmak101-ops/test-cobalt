#!/bin/sh
set -e

# Optional one-time DB setup, controlled by compose env so re-runs are cheap:
#   RUN_MIGRATIONS=1  -> create the database if missing + apply the committed Kysely T-SQL migrations
#                        (non-interactive; idempotent via kysely's migration ledger)
#   SEED_ON_START=1   -> load the demo seed (users admin@cobalt.hk/cobalt, sample data)
if [ "$RUN_MIGRATIONS" = "1" ]; then
  echo "[entrypoint] applying migrations (kysely) against SQL_SERVER_URL ..."
  # No `|| echo`: with `set -e` a migrate failure ABORTS boot, so we never serve on a broken schema.
  pnpm --filter backend run db:migrate
fi

if [ "$SEED_ON_START" = "1" ]; then
  echo "[entrypoint] seeding demo data ..."
  pnpm --filter backend seed || echo "[entrypoint] WARN: seed failed (already seeded?)"
fi

echo "[entrypoint] starting: $*"
exec "$@"
