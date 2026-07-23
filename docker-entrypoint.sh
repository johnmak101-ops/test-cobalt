#!/bin/sh
set -e

# Optional one-time DB setup (compose / deploy env):
#   RUN_MIGRATIONS=1  -> create DB if missing + apply Kysely T-SQL migrations
#   SEED_ON_START=1   -> run seed.ts (prod shape by default — see SEED_DEMO)
#
# Seed behaviour (backend/src/db/seed.ts):
#   ALWAYS:     curated ports + alert_rules + app_settings + seedAuthUsers
#               (super@ / admin@ / agent@cobalt.hk). No email_message / parsed_record.
#   SEED_DEMO=1 only: also demo masters, sample booking legs, review-queue emails
#               (local demo only — leave UNSET or 0 in Docker Hub / prod images).
#
# Masters after seed:
#   Mesh customers/vendors/forwarders — Nest MastersSyncScheduler (MESH_* + MESH_SYNC_INTERVAL_MS)
#   Ports CSV (UN/LOCODE + OurAirports) — Nest PortsSyncScheduler (PORTS_SYNC_INTERVAL_MS)
#
# Prefer compiled `dist` entrypoints (multi-stage image has no ts-node). Fall back to pnpm
# when dist is missing (local monorepo bind-mount).

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
  if [ "${SEED_DEMO}" = "1" ] || [ "${SEED_DEMO}" = "true" ]; then
    echo "[entrypoint] SEED_DEMO=1 — seeding ports + users + DEMO dataset (emails/legs) ..."
  else
    echo "[entrypoint] seeding prod-shape: ports + alert_rules + users only (no demo emails/parsed) ..."
  fi
  if [ -f backend/dist/db/seed.js ]; then
    node backend/dist/db/seed.js || echo "[entrypoint] WARN: seed failed (already seeded?)"
  else
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
