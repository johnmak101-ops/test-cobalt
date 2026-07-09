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

## Phase 0 — Spike the two hard swaps on the real Fabric DB  **(gates everything; ~1–3 days)**

Decisions are **LOCKED (2026-07-09)** — Kysely (both apps) · Azure Service Bus · local SQL Server 2022 (see
"Locked decisions" below). Phase 0 now just *proves* them before the bulk work.

### Spike 1 — Kysely on Fabric SQL (the data-access layer for BOTH apps)
- **Kysely** (typed SQL query builder; MSSQL via `tedious`) replaces Drizzle in both apps — chosen because
  both are SQL-forward (track-system's hand-tuned window-fn/aggregate/N+1 queries; cobalt-queue's ~39 raw
  SQL calls) and share one Fabric DB (one stack = one provider/migration-runner/test-harness).
- **Schema-of-truth changes:** with Kysely the truth becomes the T-SQL migrations (DDL) + `kysely-codegen`
  types; the Drizzle "schema → zod contracts" link is replaced by hand-kept (or codegen'd) zod.
- **Spike:** port ~3 representative track-system tables (with `json`, a uuid-default PK, an FK, an enum-as-
  CHECK, one window-fn query, one transaction) to Kysely on Fabric SQL; run that slice of tests green.

### Spike 2 — Azure Service Bus (replaces pg-boss, which is Postgres-only)
- **Azure Service Bus** (managed queue: native dead-letter, retries, scheduling) replaces pg-boss. Adds an
  Azure dependency (a Service Bus namespace + connection string in env) — accepted for robustness over a
  hand-rolled SQL-table queue.
- **Leverage the seam:** cobalt-queue already wraps the queue behind a `PgBoss`-typed boundary
  (`src/consumer/worker.ts` `registerWorker(boss)`, `src/consumer/index.ts`) — swap **only the adapter** there
  (map `boss.work` → receiver `receiveMessages`/`completeMessage`/`abandonMessage`; DLQ + retries are native),
  not the business logic.
- **Spike:** prove enqueue → receive(batch) → complete / abandon → dead-letter via the Service Bus SDK, wired
  into the worker seam; confirm the config knobs (retention/max-delivery) map to Service Bus settings.

**Phase 0 exit:** both spikes green on the real Fabric DB + a Service Bus namespace; a T-SQL migration runner +
a shared Kysely `db` provider pattern established.

---

## Phase 1 — Shared foundation

- **DB provider:** connection (Entra SP / SQL auth, pooling via `tedious`/`mssql`), a migration runner, and a
  fresh `0000_init` T-SQL schema per app.
- **Test engine — DECIDED: local SQL Server 2022 container** for dev + CI (same T-SQL engine family, fast
  ephemeral per-run DBs), with **Fabric SQL as the deploy target**. Verify anything Fabric-specific against a
  Fabric dev DB before deploy. Rework `backend/test/setup-db.ts` (and cobalt-queue's equivalent) to
  create+migrate a `*_test` SQL DB on the container.

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
- Replace pg-boss with **Azure Service Bus** behind the existing worker/consumer seam (`boss.work` → receiver
  loop; complete/abandon; Service Bus provides DLQ + retries natively). Map the pgboss config knobs
  (max-connections/archive/retention) to Service Bus equivalents.
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

## Locked decisions (2026-07-09)

1. **ORM: Kysely for BOTH apps** — SQL-first, MSSQL via `tedious`; both codebases are raw-SQL/JSON-forward, and
   one shared Fabric DB argues for one stack. (Prisma rejected: complex/raw SQL → `$queryRaw` + a Rust engine.)
2. **Queue: Azure Service Bus** — replaces pg-boss, behind cobalt-queue's existing worker seam; native DLQ +
   retries. (SQL-table queue was the one-DB alt; Service Bus chosen for robustness.)
3. **Test engine: local SQL Server 2022 container** for dev + CI; Fabric SQL is the deploy target.

Phase 0 (the two spikes) can start. The rest of the plan follows from these.
