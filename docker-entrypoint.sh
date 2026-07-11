#!/bin/sh
set -e

# Optional one-time DB setup, controlled by compose env so re-runs are cheap:
#   RUN_MIGRATIONS=1  -> create the database if missing + apply Kysely T-SQL migrations
#   SEED_ON_START=1   -> load the demo seed (users admin@cobalt.hk/cobalt, sample data)
#
# Prefer compiled `*:prod` entrypoints (multi-stage image has no ts-node/source). Fall back to
# pnpm/ts-node only when dist is missing (local monorepo bind-mount / non-prod image).
run_migrate() {
  if [ -f backend/dist/db/migrate-cli.js ]; then
    echo "[entrypoint] applying migrations (node dist) against SQL_SERVER_URL ..."
    node backend/dist/db/migrate-cli.js
  else
    echo "[entrypoint] applying migrations (pnpm/ts-node) against SQL_SERVER_URL ..."
    pnpm --filter backend run db:migrate
  fi
}

run_seed() {
  if [ -f backend/dist/db/seed.js ]; then
    echo "[entrypoint] seeding demo data (node dist) ..."
    node backend/dist/db/seed.js || echo "[entrypoint] WARN: seed failed (already seeded?)"
  else
    echo "[entrypoint] seeding demo data (pnpm/ts-node) ..."
    pnpm --filter backend seed || echo "[entrypoint] WARN: seed failed (already seeded?)"
  fi
}

if [ "$RUN_MIGRATIONS" = "1" ]; then
  # No `|| echo`: with `set -e` a migrate failure ABORTS boot.
  run_migrate
fi

if [ "$SEED_ON_START" = "1" ]; then
  run_seed
fi

echo "[entrypoint] starting: $*"
exec "$@"
