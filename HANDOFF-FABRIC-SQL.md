# Fabric SQL migration — ✅ COMPLETE (2026-07-10)

**Repos:** `D:/cobalt_track_system` (ShipTrack) + `D:/cobalt-queue` (Agent VM). Both on `main`, all merged.
**Plan:** `FABRIC-SQL-MIGRATION-PLAN.md` · **ADR:** `ADR-database-platform-fabric-vs-postgres.md` ·
**State detail:** `TODO.md` § "Fabric SQL migration".

## What landed

| Phase | PRs | Result |
|---|---|---|
| 2 (ports) | track #49–#60 | 13 Kysely/SQL Server repo twins + T-SQL `0000_init` + codegen + CI mssql job |
| 2-swap (cutover) | track **#61** | twins BECAME the repositories; app boots on `SQL_SERVER_URL`; whole suite (634 backend + 198 frontend) on the `mssql-2022` engine; seed/scripts ported; `migrate-cli` (creates DB if missing); CI single-job on an mssql service |
| retire | track **#62** | Drizzle provider/schema/Postgres migrations + `drizzle-*`/`pg` deps DELETED; `contracts.ts` = zod only; enums in `src/db/enums.ts` |
| 3 (queue) | queue **#52** | 8-table T-SQL schema on Kysely; every call site ported; **RabbitMQ replaces pg-boss** (RabbitBoss: fixed-TTL retry ladder 60/120/240s + `email.process.dead`); `pg`/`pg-boss`/`drizzle-*` deleted; suite 697/699 (2 broker-gated, proven live 4/4) |
| 4 (e2e) | — | live on real containers: enqueue → RabbitMQ → worker → `parsed_record` → matcher + critic (+ curated facts over `GET /api/masters/resolution`) → `POST /api/decisions` → shipment (provisional, PO linked, gate reason carried) + `evidence[]`→ingest mirror + alert evaluator |

## Where things live now

- Track schema-of-truth: `backend/src/db/kysely-migrations/*.ts` (ships in `dist/`); types: `db.generated.ts`
  + the curated overlay `backend/src/db/kysely/db.ts` (**import `DB` from the overlay**); enum arrays:
  `backend/src/db/enums.ts`. Queue equivalents under `cobalt-queue/src/db/`.
- Dev/CI engine: local `mssql-2022` container (`localhost:1433`, sa / `YourStrong!Passw0rd`) + `rabbitmq:3-management`
  (5672/15672). **Fabric SQL is the deploy target** — see the follow-up below.
- Migrations: `pnpm --filter backend run db:migrate` (track) / `pnpm db:migrate` (queue) — both create their
  database if missing and apply incrementally via Kysely's ledger.
- The SQL Server gotcha catalogue (TOP-not-LIMIT, OUTPUT, check-then-insert upserts, JSON nvarchar
  parse-on-read/stringify-on-write, uppercase GUIDs, single-NULL uniques, 2100-param cap, no regexp_replace)
  is in `TODO.md` § "Fabric SQL migration".

## Deployment — ✅ SHIPPED (2026-07-10)

**Prod has exactly ONE Fabric SQL database** (`ShipTrackDB-e14b63df-…`). Fabric isn't a conventional server —
each SQL DB is a workspace *item* (created via portal / Fabric CLI / REST; no T-SQL `CREATE DATABASE`), and we
get one. So **both apps share that one DB via SQL schemas**: ship-track owns `dbo.*` (30 tables); cobalt-queue
lives in `queue.*` (8 tables). Each keeps its own `kysely_migration` ledger (`dbo.` vs `queue.`); both connect
as the same Entra **Service Principal** (db_owner). The SP secret == the Cobalt Mesh web-API client secret
(client `f0ab0d15…`; `565da2f9…` is only the Mesh resource app).

### PRs
| Repo | PR | What |
|---|---|---|
| ship-track | #70 | Entra SP auth (`Authentication=Active Directory Service Principal`, encryption forced) + skip `CREATE DATABASE` on Fabric |
| cobalt-queue | #55 | same Entra auth + move all tables into a `queue` schema (`WithSchemaPlugin('queue')` + hand-qualified raw SQL + codegen `--default-schema queue`, type keys unchanged) |
| cobalt-queue | #56 | fix viewer `/stats` — a subquery inside `SUM()` is invalid on SQL Server (error 130); split into two `COUNT`s + `NOT EXISTS` in `WHERE` |
| cobalt-queue | #57 | `CREATE SCHEMA [queue] AUTHORIZATION [dbo]` — a bare `CREATE SCHEMA` makes the Entra SP the schema owner, which Fabric can't resolve (error 33134) |

Queue design detail: `cobalt-queue/QUEUE-SCHEMA-SEPARATION-PLAN.md`.

### Deploy runbook (either app → the shared Fabric DB)
Same connection string for both (they share `ShipTrackDB`); only the schema differs, handled in code. Secrets
come from `Master_Data_API.md` / the provisioning email — never in git.
```powershell
$env:SQL_SERVER_URL='Server=<endpoint>.database.fabric.microsoft.com,1433;Database=ShipTrackDB-…;Authentication=Active Directory Service Principal;User Id=<client-id>;Password=<SP secret>;Tenant Id=<tenant>;Encrypt=true'
# ship-track   (in backend/):   npm run db:migrate    → dbo.*
# cobalt-queue (in repo root):  pnpm db:migrate       → queue.*  (creates the schema, owned by dbo)
```
Migrations are idempotent (Kysely ledger); Entra mode auto-skips `CREATE DATABASE` (the DB is pre-provisioned).

## Follow-ups (non-blocking, tracked in TODO.md)

1. **Fabric-deploy verification** — ✅ **DONE (2026-07-10)** — see the Deployment section above. Both apps
   connect via Entra SP and migrate cleanly into the one shared `ShipTrackDB` (ship-track `dbo.*`, cobalt-queue
   `queue.*`); ship-track live-verified end-to-end. `sp_MSforeachtable` paths (test reset, demo wipe) stay
   dev-only by design.
2. **Queue corpus re-ingest** — the parsed corpus lives in the old Postgres `cobalt_queue`; the fresh SQL DB
   starts empty (re-ingest .msg corpus / Graph backfill, then the deferred full re-parse).
3. **LLM Master Matcher re-spec** — `pg_trgm` retrieval → T-SQL Full-Text / similarity UDF
   (banner added at the top of `LLM-MASTER-MATCHER-SPEC.md`); the deterministic resolution tiers were
   PORTED (not dropped) and stay live until it lands.
