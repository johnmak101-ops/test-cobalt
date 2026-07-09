# Handoff — Fabric SQL migration, Phase 2 complete

**Date:** 2026-07-09  ·  **Repo:** `D:/cobalt_track_system` (ShipTrack / cobalt_track_system)
**State:** `main` is clean, in sync with `origin/main`. All work merged.

## What was done this session

Ported **all 13** ShipTrack Drizzle repositories to Kysely/SQL Server (Fabric SQL target), one PR per repo,
each with a SQL Server integration spec gated on `FABRIC_FOUNDATION=1`. This **completes Phase 2** of
`FABRIC-SQL-MIGRATION-PLAN.md` (track-system data layer → SQL).

| repo | PR | tests |
|---|---|---|
| foundation (0000_init T-SQL + codegen + CI mssql job) | #49 | 30 |
| masters | #50 | — |
| settings/users/audit (leaf) | #51 | 4 |
| ingest | #52 | 2 |
| evidence | #53 | 4 |
| purchase-order | #54 | 5 |
| alert | #55 | 8 |
| field-lock | #56 | 5 |
| review-email | #57 | 5 |
| booking | #58 | 8 |
| email | #59 | 10 |
| shipment | #60 | 10 |

**Merges #55–#57 needed rebase:** they each edited the same single CI workflow line (the `vitest run` spec
list in `.github/workflows/ci.yml`), so each later one conflicted with main after the prior landed. Resolved
by rebasing and keeping the cumulative spec list; force-pushed with `--force-with-lease`. #58–#60 merged clean.

## Final state (verified on main)

- `git log --oneline -5` → top commit `8f2b5ac docs(todo): record Fabric SQL Phase 2 completion…`
- 13 files matching `backend/src/db/repositories/*.kysely.ts`
- Full SQL Server suite: **12 files, 97 tests, all green** against the local `mssql-2022` container.
- `pnpm lint` → 0 errors (6 pre-existing frontend react-hooks warnings, unrelated).
- CI `build-and-test-sqlserver` job runs all 12 spec files; `build-and-test` (Postgres) still runs the full
  existing suite (the ports are NOT yet wired into the app — see "Next").

## What the ports are (and are NOT)

Each `*.repository.kysely.ts` is a **twin** of the Drizzle original, built alongside it (same file name minus
the `.kysely` infix). They are **NOT yet wired** — `backend/src/db/repositories.module.ts` still injects the
Drizzle originals via `@Inject(DRIZZLE)`. No runtime behavior changed. The kysely int specs exercise the
ports directly (they `new KyselyXxxRepository(db)`), bypassing the Nest module.

## Critical SQL Server gotchas (encoded in the ports — apply to the swap + Phase 3)

1. **Kysely 0.29 `MssqlDialect` emits `.limit(n)` VERBATIM** as `limit` (Postgres syntax) → SQL Server rejects
   it. Use `.modifyFront(sql`top ${sql.lit(n)}`)` for row caps. `… limit 1` in raw subqueries → `select top 1 …`.
2. **`STRING_AGG` has no `DISTINCT`** in SQL Server → aggregate over a `SELECT DISTINCT` subquery.
3. **`order by … nulls last`** → `case when x is null then 1 else 0 end asc` + `expr desc` (NULLs sort first in ASC).
4. **`GROUP BY` must list every non-aggregated selected column** (no Postgres functional-dependency shortcut) — see `email.repository.kysely.ts` `thread()`.
5. **`onConflictDoNothing`/`onConflictDoUpdate`** → check-then-insert/update catching the unique violation.
   (`dedup_key` on alerts is always set by the evaluator → the SQL Server single-NULL unique gotcha is safe.)
6. **`returning`** → `.output('inserted.col')` / `.outputAll('inserted')` / `.outputAll('deleted')`.
7. **`count(*)::int`** → `count(*)` cast to `number` client-side (codegen types it as `string`).
8. **JSON `nvarchar(max)` columns** (`match_keys`, `country_thresholds`, `fields`, `match_keys`) → stringify on
   insert; `ParseJSONResultsPlugin` parses them back to objects on read (don't assert they're strings in tests).
9. **`bit` columns** (`is_current`, `is_primary`, `enabled`, `locked`) come back as JS `boolean`, not 0/1.
10. **SQL Server returns `uniqueidentifier`s UPPERCASE** → compare UUIDs case-insensitively (`.toLowerCase())`).
11. **`entity_id`/FKs are `uniqueidentifier`** → tests must pass real UUIDs (`randomUUID()`), not string literals.
12. **Cross-test data leaks** (one shared DB per spec file) → assert on SPECIFIC seeded rows, not global counts/positions.
13. **Kysely 0.29 doesn't export `Insertable`** → `replace*` methods take `Record<string,unknown>[]` cast `as never`.

## NEXT — Phase 2-swap: wire the Kysely ports into the module (the cutover)

Full detail in `TODO.md` ("Fabric SQL migration" section). Summary:

1. Add a Kysely `db` provider (`createKysely<DB>(connStr)`) analogous to `drizzle.provider.ts`, config from env
   (`SQL_SERVER_URL` — see the conn-string shape in `mssql-dialect.ts`).
2. Replace each repository's `@Inject(DRIZZLE)` class with its `*.kysely.ts` twin in `repositories.module.ts`,
   one repo at a time. Pre-production = no live data; the Postgres suite is the net.
3. **Acceptance gate = the full service-level Postgres test suite passes against the Kysely-backed repos on
   SQL Server.** Re-point `backend/test/setup-db.ts` at the mssql container (or run both engines in CI during the swap).
4. Audit call-sites for Drizzle ergonomics the ports changed: `updateLeg`/`update`/`dismissDocument` returned
   thenable Drizzle queries (callers `await` without reading) — Kysely ports return the row/`void` (verified
   safe). `insertLeg`/`create` return the row (committer uses `leg`).
5. Retire Drizzle: `drizzle.provider.ts`, `db/schema/*`, the Postgres `backend/drizzle` migrations. KEEP the
   kysely int specs.
6. Point dev/docker-compose + `AGENTS.md` at the SQL engine (plan Phase 4).

## THEN — Phase 3: cobalt-queue data layer + RabbitMQ (the OTHER app; unstarted)

Repo: `D:/cobalt-queue`. 8-table schema (queue/evidence) → T-SQL on Kysely; replace pg-boss with RabbitMQ
behind the existing worker seam (`src/consumer/worker.ts` `registerWorker(boss)`). A RabbitBoss adapter spike
is already green there (PR #51 in that repo, `RABBITMQ_SPIKE=1`-gated). Green gate = cobalt-queue's suite
passes on SQL Server. See plan Phase 3 + `LLM-MASTER-MATCHER-SPEC.md` §5/§8 follow-up (re-spec `pg_trgm`
retrieval → T-SQL Full-Text / similarity UDF).

## Local dev env (for the next agent)

- `mssql-2022` Docker container is running on `localhost:1433` (sa / `YourStrong!Passw0rd`), DB `cobalt_test`.
- Run the SQL Server specs locally: `cd backend && FABRIC_FOUNDATION=1 npx vitest run test/<name>.kysely.int.spec.ts`
- Run the full SQL Server suite: `cd backend && FABRIC_FOUNDATION=1 npx vitest run test/foundation.int.spec.ts test/*.kysely.int.spec.ts`
- Typecheck: `cd backend && npx tsc --noEmit -p tsconfig.json`  ·  Lint: `pnpm lint`
- Key files: `backend/src/db/kysely/{mssql-dialect.ts, migrate.ts, db.generated.ts}`,
  `backend/kysely-migrations/0000_init.ts`, `.github/workflows/ci.yml` (the `build-and-test-sqlserver` job).
