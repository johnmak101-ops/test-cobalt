# Migration Plan — PostgreSQL → Microsoft Fabric SQL (ShipTrack + cobalt-queue)

> **Status:** plan, ready to execute (Phase 0 decisions need the architect's sign-off). **Date:** 2026-07-09.
> **Mandate:** Fabric SQL Database is the system-of-record for BOTH apps (one shared DB, separate schemas).
> **Grounding:** live inspection of the empty Fabric SQL DB (EngineEdition 12, native json/uuid/datetimeoffset)
> + both codebases. See `ADR-database-platform-fabric-vs-postgres.md`.

## The dev-stage advantage (shapes everything)

We are **pre-production — no live data.** So this is a **"port the code + rebuild the schema fresh"** job, NOT
a live data migration:
- No data migration, no dual-write, no cutover window, no rollback drama.
- **Drop the Postgres migration history**; generate ONE fresh `0000_init` T-SQL schema per app.
- Iterate freely. The existing **test suites are the acceptance gate** — every test must pass on SQL Server /
  Fabric SQL (they encode the behavior). track-system = 539 tests; cobalt-queue has its own.
- The reworked seed repopulates dev; **masters come from the Mesh sync** (an external API — unaffected).

## What does NOT change

- The **HTTP boundary** (`POST /api/decisions`, `GET /api/masters/resolution`, Microsoft Graph) — untouched.
- All **business logic** (committer, alerts, presentation, decisions, the parser soul/matcher) — only the
  **persistence + queue** layers change.
- The two apps stay **separate** (own schemas in the one Fabric DB); the recent 2-service split's HTTP contract holds.
- **Tests are the safety net** — port table-by-table / repo-by-repo, keeping them green continuously.

---

## Phase 0 — Lock two decisions + spike them on the real Fabric DB  **(gates everything; ~1–3 days)**

Two choices shape all later work. Prove both on the empty Fabric DB before committing.

### Decision 1 — the data-access layer (Drizzle `pg-core` has no SQL Server dialect)
- **Recommended: Kysely** (typed SQL query builder; MSSQL via `tedious`). Closest to the current SQL-first
  style (the repos lean on hand-tuned SQL — window fns, aggregates, the N+1 fixes); keeps full SQL control;
  types via `kysely-codegen`; migrations = hand-written T-SQL (the team already writes raw SQL migrations).
- **Alt: Prisma** — schema-as-code + generated client + managed migrations, mature MSSQL; better managed-
  migration DX, but a bigger paradigm shift and awkward for the complex/raw SQL this codebase uses.
- **Do NOT** bet on Drizzle's experimental MSSQL support for a mandated migration.
- **Note:** the "schema-as-truth → zod contracts" model (Drizzle today) changes: with Kysely the source of
  truth becomes the T-SQL migrations (DDL) + generated types; zod contracts are hand-kept or regenerated.
- **Spike:** port ~3 representative track-system tables (with `json`, a uuid-default PK, an FK, an enum-as-
  CHECK, one window-fn query, one transaction) to the chosen ORM on Fabric SQL; run that slice of tests green.

### Decision 2 — the job queue (pg-boss is Postgres-only)
- **Recommended: a SQL-table queue in the Fabric DB** — keeps everything in one DB (matches the mandate), no
  new infra. A `queue.job` table + lease pattern (`UPDATE TOP(n) … OUTPUT` or `WITH (UPDLOCK, READPAST)`), a
  polling worker, a dead-letter table, and a retention/cleanup job — reproduces pg-boss's work / retry /
  dead-letter / archive (all of which cobalt-queue configures today).
- **Alt: Azure Service Bus** — managed, built-in DLQ + retries, but adds infra + a non-DB dependency (breaks
  "one MS SQL"). Choose this only if the SQL-queue proves too fiddly.
- **Leverage the seam:** cobalt-queue already wraps the queue behind a `PgBoss`-typed boundary
  (`src/consumer/worker.ts` `registerWorker(boss)`, `src/consumer/index.ts`) — swap the impl there, not the
  business logic.
- **Spike:** prove enqueue → lease(batch) → complete / retry / dead-letter → cleanup on Fabric SQL, wired
  into the worker seam.

**Phase 0 exit:** ORM + queue chosen and **spike-proven on the real Fabric DB**; a T-SQL migration runner + a
shared `db` provider pattern established; the dev/CI test-engine decided (below).

---

## Phase 1 — Shared foundation

- **DB provider:** connection (Entra SP / SQL auth, pooling via `tedious`/`mssql`), a migration runner, and a
  fresh `0000_init` T-SQL schema per app.
- **Test-engine decision (important):** int tests need a throwaway SQL DB per run; Fabric SQL is a poor fit for
  ephemeral per-run DBs. **Recommend dev + CI run on a local SQL Server 2022 (or Azure SQL Edge) container**
  (same T-SQL engine family), with **Fabric SQL as the deploy target**. Verify anything Fabric-specific against
  a Fabric dev DB before deploy. Rework `backend/test/setup-db.ts` (and cobalt-queue's equivalent) to
  create+migrate a `*_test` SQL DB.

## Phase 2 — track-system data layer → SQL  **(the bigger app; first — it has no queue)**

- Port the **29-table** schema (tracking/audit/alerts/ingest) to T-SQL — type map: `jsonb→json`,
  `uuid→uniqueidentifier DEFAULT NEWID()`, `timestamptz→datetimeoffset`, `bigserial→bigint IDENTITY`,
  `bytea→varbinary(max)`, `text{enum}→nvarchar + CHECK`, `pgSchema→CREATE SCHEMA`.
- Rewrite the repositories on the new ORM; replace Postgres-isms: `onConflictDoNothing → MERGE` (or
  `IF NOT EXISTS`), `truncate … restart identity cascade`, `returning → OUTPUT`, jsonb ops →
  `JSON_VALUE`/`OPENJSON`, `ilike → LIKE` (collation), array `$type` columns → json.
- Port `seed.ts` (already `SEED_DEMO`-gated) + the standalone scripts (`sync-masters`, `reclassify-*`,
  `cleanup-*`). The Mesh sync's `MeshClient` is HTTP — unchanged; only its repo writes change.
- **Green gate:** the full **539-test** suite passes on SQL. That's the acceptance criterion for this phase.

## Phase 3 — cobalt-queue data layer + queue → SQL

- Port the **8-table** schema (queue/evidence) to T-SQL on the new ORM.
- Replace pg-boss with the Phase-0 queue impl behind the existing worker/consumer seam (+ retention/DLQ).
- Port its migrations + dev scripts (`reparse-all`, etc.). **Green gate:** cobalt-queue's suite passes on SQL.

## Phase 4 — Integration + dev cutover

- Point both apps at the **one Fabric SQL DB** (separate schemas: tracking/audit/alerts/ingest + queue/evidence).
- Run the **e2e** (cobalt-queue → `POST /api/decisions` → track-system) on Fabric SQL.
- Update dev env / docker-compose / CI to the SQL engine; update `AGENTS.md` + the `build-infra-gotchas` notes.

## Phase 5 — Follow-ups

- The **LLM-matcher spec's `pg_trgm`** retrieval → a SQL Server approach (Full-Text Search, or a similarity
  UDF / candidate pre-filter). The matcher isn't built yet → this is a **spec edit, not a blocker**. Update
  `LLM-MASTER-MATCHER-SPEC.md` §5/§8.
- Index/perf pass (the N+1 fixes carry over; re-tune for SQL Server plans).

---

## Risks & mitigations

- **ORM-swap churn (~55 files)** → tests are the net; go table-by-table/repo-by-repo, green continuously.
- **Queue correctness** → spike hard in Phase 0; keep the worker seam so the impl stays swappable.
- **Fabric-specific gaps** (ephemeral test DBs, T-SQL/Fabric feature limits, JSON ergonomics) → dev/CI on local
  SQL Server; Fabric as deploy target; verify Fabric-only behaviors early against a Fabric dev DB.
- **Hidden Postgres-isms** → audit up front: `grep -rE "jsonb|on conflict|returning|::| ~ |gen_random|array\[|serial|nextval|ilike|restart identity"` across both `src/`.
- **Scope creep** → business logic is frozen; only persistence + queue change.

## Sequencing

Phase 0 (decide + spike) → 1 (foundation) → 2 (track-system, green) → 3 (cobalt-queue + queue, green) →
4 (integrate + cutover) → 5 (follow-ups). **Each app phase ends only when its full test suite is green on SQL
Server / Fabric — that is the objective gate, and dev-stage means there's no data or cutover to get wrong.**

## Decisions needed now (architect)

1. **ORM:** Kysely (recommended, SQL-first) vs Prisma (schema-as-code + managed migrations)?
2. **Queue:** SQL-table queue in Fabric (recommended, one-DB) vs Azure Service Bus?
3. **Dev/CI test engine:** local SQL Server 2022 / Azure SQL Edge container (recommended) vs a Fabric dev DB?

Confirm these three and Phase 0 (the spike) can start; the rest of the plan is robust to the choices.
