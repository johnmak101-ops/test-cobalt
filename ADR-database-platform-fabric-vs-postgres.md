# ADR: Database platform — PostgreSQL vs Microsoft Fabric SQL (ShipTrack + cobalt-queue)

> **Status:** Proposed — needs the architect's decision. **Date:** 2026-07-09.
> Grounded in a live inspection of the provisioned Fabric SQL DB + both codebases (2026-07-09).

## Context

- Two production apps: **track-system** (ShipTrack / VM1, `D:\cobalt_track_system`) and **cobalt-queue**
  (Agent / VM2, `D:\cobalt-queue`). Both currently on **PostgreSQL** — separate DBs (`cobalt` + `cobalt_queue`),
  HTTP-only boundary (`POST /api/decisions` + `GET /api/masters/resolution`).
- Prod has a provisioned **Microsoft Fabric SQL Database** ("ShipTrackDB…", endpoint `…database.fabric.microsoft.com`).
  Directive: both projects should "live in the same MS SQL."
- **Question:** migrate both apps onto the shared Fabric SQL DB, or keep Postgres?

## Findings (live inspection, 2026-07-09)

**The Fabric SQL DB (via `sqlcmd` + the Entra SP — same SP as the Mesh API, `f0ab0d15…`, db_owner):**
- **EMPTY** — only the `dbo` schema, **0 user tables / 0 project schemas**. Neither app is deployed there yet;
  "both live in the same MS SQL" is the **target**, not the current state.
- **EngineEdition = 12 = "SQL database in Microsoft Fabric"** — the **transactional / OLTP** offering (Azure
  SQL engine), **not** the analytical Warehouse (11). So it *can* host OLTP apps.
- Native types present: **`json`**, `uniqueidentifier`, `datetimeoffset`, `varbinary`, `bigint`, `nvarchar` —
  so the Postgres→T-SQL type mapping is feasible (jsonb→json, uuid→uniqueidentifier + NEWID, timestamptz→
  datetimeoffset, bytea→varbinary, bigserial→bigint IDENTITY, text-enum→nvarchar + CHECK).

**Both apps are deeply Postgres-coupled:**
| | track-system | cobalt-queue |
|---|---|---|
| ORM / driver | Drizzle `pg-core` + `pg` | Drizzle `pg-core` + `pg` |
| Schemas | tracking / audit / alerts / ingest | queue / evidence |
| Migrations | ~18 `drizzle/*.sql` (Postgres) | 6 (Postgres) |
| Postgres-only extras | planned matcher needs **`pg_trgm`** | **`pg-boss`** (Postgres-only job queue) |

## The refactor surface (for a full move to Fabric SQL)

**Hard blockers (not just a config change):**
1. **Drizzle has no stable SQL Server dialect.** Both apps' schema definitions + queries are `drizzle-orm/pg-core`
   (~55 files across the two repos). A T-SQL move means **swapping the ORM** (Kysely / TypeORM / Prisma all
   support SQL Server) or dropping to raw T-SQL — a rewrite of every schema file + repository.
2. **`pg-boss` is Postgres-only** (LISTEN/NOTIFY + advisory locks). Fabric SQL has no equivalent — cobalt-queue's
   **job queue must be re-architected** (Azure Service Bus, a SQL-table queue, or a Fabric-native eventstream).
   This is the single biggest cobalt-queue cost.
3. **`pg_trgm`** (the planned LLM-matcher's fuzzy candidate retrieval) has no SQL Server equivalent → SQL Server
   full-text search or a different similarity approach.
4. **All migrations → T-SQL**, and the Postgres-isms sprinkled through both apps: `onConflictDoNothing`→`MERGE`,
   `truncate … restart identity cascade`, `jsonb` operators, `pgSchema`, `bigserial`, the migration ledger +
   `setup-db.ts`, raw `pool.query(sql)` scripts (seed, sync-masters, reclassify).

**Non-blockers:** the engine is capable (EngineEdition 12 + the needed types); the multi-schema layout maps to
T-SQL schemas; the recent clean 2-DB split maps to two schemas in one Fabric DB with the HTTP boundary intact.

## Options

**A. Full migration to Fabric SQL (both apps).** Rewrite the data layer to T-SQL in both: ORM swap, schema,
migrations, Postgres-isms; replace `pg-boss`; replace `pg_trgm`. **Large, multi-week, high-risk** (touches the
entire persistence + queue layer). Pro: single Microsoft/Fabric stack; data auto-mirrored to OneLake for BI;
uses the provisioned DB. Con: huge rewrite; loses Drizzle; re-architects the queue.

**B. Keep Postgres (OLTP) + mirror into Fabric for BI.** Apps unchanged; replicate Postgres → Fabric OneLake
via **Fabric Mirroring** (Azure DB for PostgreSQL / open mirroring) or CDC. **Small, additive, no app refactor.**
Pro: zero app risk; Power BI / analytics on Fabric; keeps the strong stack (Drizzle + pg-boss + pg_trgm). Con:
two platforms; the provisioned Fabric SQL DB isn't the app store.

**C. Hybrid / phased.** e.g. migrate only track-system to Fabric SQL, keep cobalt-queue on Postgres (pg-boss).
Splits the stack across two DB engines with a cross-engine boundary — messy; not recommended.

## Decision drivers (need the architect)

- **The real "why Fabric":**
  - "Fabric is our BI/analytics/data platform" → **Option B** (mirror). Almost certainly the cheaper, correct answer.
  - "One Microsoft-managed DB / data residency / the prod DB is provisioned, so run on it" → **Option A**.
- Appetite for a multi-week data-layer + queue rewrite vs. keeping the working Postgres stack.
- Whether Drizzle must stay (it can't do SQL Server) — the ORM swap is the biggest single cost.

## Recommendation

- **If the goal is analytics/BI in Fabric → Option B (mirror).** Cheap, safe, keeps the stack. Do this regardless
  — Fabric SQL Database auto-mirrors to OneLake, so even a small footprint gives Power BI the data.
- **If the mandate is Fabric SQL as the system-of-record → Option A, as a deliberate project** (own spec + plan),
  de-risked in this order:
  1. **Spike first** (1–2 days): prove the two hard swaps on the empty Fabric DB — (a) the replacement ORM
     (recommend **Kysely** — SQL-first, MSSQL dialect, lightest lift from Drizzle) round-trips the schema +
     JSON + a transaction; (b) a `pg-boss` replacement pattern (Service Bus or a SQL-table queue) handles the
     agent's enqueue/lease/complete. If either spike is ugly, revisit.
  2. **track-system first** (simpler — no queue): ORM swap + schema/migrations to T-SQL + replace `pg_trgm` in
     the matcher plan.
  3. **cobalt-queue second** (the queue re-architecture is the hard part).
  4. Data migration + cutover. Keep the HTTP boundary; two schemas in the one Fabric DB.
  - Budget: **weeks**, gated by the spike.

## Consequences

- Option B: minimal risk; ongoing dual-platform ops; Fabric is analytics-only.
- Option A: single platform + native OneLake analytics, but a large one-time rewrite, loss of Drizzle/pg-boss/
  pg_trgm, and the LLM-matcher spec (which assumes `pg_trgm`) needs its retrieval reworked for SQL Server.

## Appendix — how to inspect the Fabric DB (reproduce)

`sqlcmd` (go-sqlcmd, `C:\Program Files\SqlCmd\sqlcmd.exe`) with the Entra SP (client `f0ab0d15…`, secret in
`Master_Data_API.md` — env `SQLCMDPASSWORD`, never commit it), `--authentication-method=ActiveDirectoryServicePrincipal`,
`-d ShipTrackDB-…`. See the `cobalt-prod-access-topology` memory for the endpoint + DB id.
