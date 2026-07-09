# Phase 1+2 — track-system → SQL Server (dual-DB, repo-by-repo) Design

> **Status:** design, 2026-07-09. Covers migration-plan Phase 1 (shared foundation) + Phase 2 (track-system
> data layer). Phase 0 (spikes) is merged. This is the spec for the track-system port; cobalt-queue's port
> is Phase 3 (own plan).
> **Spec:** `FABRIC-SQL-MIGRATION-PLAN.md` (locked decisions: Kysely both apps · RabbitMQ · local SQL Server
> 2022 container; Phase 0 findings in PR #48).

## 0. Shaping decisions (locked)

1. **Dual-DB harness (B).** Postgres stays the primary CI gate. A SQL Server harness runs *alongside* it
   (locally + CI). Each repo port: write it on Kysely/SQL Server, keep the old Drizzle/Postgres path green
   until the port is complete, then delete the old path. Tests stay green on Postgres throughout; SQL Server
   coverage grows repo-by-repo. No big-bang red period.
2. **Port by repository (B).** A repository + its tables is the porting unit (the code is organized that
   way; joins stay coherent). Ordering is FK-leaf-first. ~12 ports.

## 1. Porting order (FK-leaf-first, by repo)

Derived from the actual `schema.*` references in each repo (verified 2026-07-09):

| # | Repo | Tables (schema) | Depends on (already-ported repos) |
|---|------|-----------------|-----------------------------------|
| 0 | *(foundation)* | `app_settings`, `users`, `refresh_tokens` | — |
| 1 | `MastersRepository` | customers, vendors, forwarders, forwarder_aliases, consignees, ports, master_resolution | none |
| 2 | `SettingsRepository` | app_settings | none (own table only) |
| 3 | `UsersRepository` | users, refresh_tokens | none |
| 4 | `AuditRepository` | change_log | none (write-only, FK → users optional) |
| 5 | `IngestRepository` | ingest.email_message, email_attachment, parsed_record, ingest_state | none (ingest schema, self-contained) |
| 6 | `EvidenceRepository` | ingest.email_message, parsed_record (reads) | Ingest |
| 7 | `PurchaseOrderRepository` | purchase_orders, (reads bookings/shipments/customers/vendors/ports) | Masters |
| 8 | `BookingRepository` | bookings, booking_pos | Masters, PurchaseOrder |
| 9 | `AlertRepository` | alert_rules, alert_instances | — (own schema; FK → shipments via logical id, no hard FK) |
| 10 | `ShipmentRepository` | shipments + children (shipment_pos, shipment_identifiers, shipment_parties, shipment_milestones, shipment_emails) | Masters, PurchaseOrder, Booking |
| 11 | `ReviewEmailRepository` | review_email | Shipment, Booking |
| 12 | `FieldLockRepository` | field_locks (FK → shipments/users) | Shipment, Users |
| 13 | `EmailRepository` | email_read, ingest.* reads, review_email reads, shipment_emails | Ingest, Shipment, ReviewEmail |

**Foundation (Step 0)** comes first: the `0000_init` T-SQL schema for ALL 29 tables (one migration so FK
order is satisfiable), the SQL Server `setup-db` harness, CI wiring. Then repos port in order.

## 2. Foundation — the shared layer (Step 0, before any repo port)

### 2a. The `0000_init` T-SQL schema (all 29 tables)
- One Kysely TS migration (`backend/kysely-migrations/0000_init.ts`) porting all 29 tables from the Drizzle
  schema (`backend/src/db/schema/*.ts`), in FK-creation order. Type map (from the ADR + Phase 0 findings):
  `uuid→uniqueidentifier DEFAULT NEWID()`, `timestamptz→datetimeoffset(7)`, `jsonb→NVARCHAR(MAX)`,
  `text{enum}→nvarchar + CHECK`, `bigserial→bigint IDENTITY(1,1)`, `pgSchema→CREATE SCHEMA`.
- **Decision: keep the `tracking`/`ingest`/`alerts`/`audit` SCHEMA names** (not flatten to `dbo`). SQL
  Server supports schemas; Kysely addresses them as `db.selectFrom('tracking.shipments')`. This keeps the
  Drizzle schema-of-truth legible and the port 1:1. *(Phase 0 used `dbo` for the spike only.)*
- The Drizzle schema files STAY as the readable reference; Kysely's `kysely-codegen` (run against the
  migrated SQL Server DB) generates the typed `Database` interface. **No hand-written `SpikeDB`-style
  interfaces for the full port** — codegen is the source of truth (the Phase 0 spike's hand interface was
  spike-only).

### 2b. The SQL Server test harness (`setup-db.ts`)
- Add `getSqlServerTestDb()` alongside the existing `getTestDb()` (Postgres). It: ensures `cobalt_test`
  exists on the container → drops all tables (FK-child-first) + the Kysely migration ledger → runs
  `runMigrations` → returns a typed `Kysely`. `resetSqlServerDb()` truncates (or drops+recreates) between
  specs. `closeSqlServerTestDb()` destroys.
- Gated behind `SQL_SERVER_TEST=1` (off by default; CI turns it on in a second job; locally set it + run the
  container). Specs that haven't been ported yet run only on Postgres (unchanged).

### 2c. CI wiring
- Add a second job to `.github/workflows/ci.yml` that spins up the `mcr.microsoft.com/mssql/server:2022-latest`
  container (mirroring the existing `postgres` service) + runs `SQL_SERVER_TEST=1 pnpm --filter backend run
  test`. The Postgres job stays the primary gate; the SQL Server job is informational (allowed to fail
  during the port, becomes required at the end of Phase 2).

### 2d. The Kysely `Database` type via codegen
- `pnpm --filter backend add -D kysely-codegen`. A `db:codegen` script runs `kysely-codegen` against the
  migrated `cobalt_test` → emits `backend/src/db/kysely/db.generated.ts`. Committed; regenerated when the
  `0000_init` migration changes.

## 3. The port unit (per repo, repeated ~12 times)

Each repo port is one branch → one PR, all-green on both engines:

1. **Kysely port.** A new `backend/src/db/repositories/<name>.kysely.ts` (or replace in place once the old
   is deleted) implementing the same method signatures over `Kysely<Database>`. Apply Phase 0 findings:
   `.returning()` → `.output('inserted.x')`; `onConflictDoNothing` → `MERGE` or `IF NOT EXISTS`;
   `truncate … restart identity cascade` → explicit child-first delete; `ilike` → `LIKE` (case-insensitive
   collation); jsonb ops → `JSON_VALUE`/`OPENJSON`; array `$type` → `NVARCHAR(MAX)` json.
2. **Specs dual-run.** Each `*.int.spec.ts` for the repo: parameterize the DB source so it runs against BOTH
   Postgres (Drizzle) and SQL Server (Kysely) when `SQL_SERVER_TEST=1`. Same assertions; the spec proves
   both engines behave identically.
3. **Green on both.** Postgres gate stays green (Drizzle path untouched). SQL Server job goes green for
   this repo's specs.
4. **Cutover.** Once the Kysely port passes all the repo's specs on both engines AND nothing else references
   the repo's Drizzle internals: delete the Drizzle repo implementation, point the NestJS providers at the
   Kysely one. The repo's tables are now "ported."
5. **One PR per repo.** Reviewed + merged individually. `main` stays green on Postgres throughout.

## 4. What does NOT change (frozen for Phase 1+2)

- All business logic (committer, alerts, presentation, decisions) — only persistence changes.
- The HTTP boundary (`POST /api/decisions`, `GET /api/masters/resolution`).
- The frontend.
- cobalt-queue (Phase 3).

## 5. Risks & mitigations

- **29-table schema port is large** → one `0000_init` migration, verified by codegen + the existing specs
  running against it (Drizzle repos that "just work" against SQL Server prove the schema is correct even
  before their Kysely port).
- **Drizzle repos won't run on SQL Server** (Postgres-isms) → they don't have to. The Drizzle path stays on
  Postgres; only the Kysely port targets SQL Server. The schema is verified by codegen + ported-repo specs.
- **Dual-DB spec parameterization is fiddly** → a small `withBothDbs()` test helper abstracts it; the spike
  proved the harness pattern.
- **Codegen drift** → regenerate on every `0000_init` change; CI asserts the committed file is up to date.
- **`moduleResolution: node` + `kysely/migration`** → already solved in Phase 0 (tsconfig `paths`).

## 6. Open decisions (resolve in the per-repo plans or here)

1. **`kysely-codegen` connection** — point at the local `cobalt_test` (needs the container) or a dedicated
   `cobalt_codegen` DB? → local `cobalt_test` is fine (it's migrated on demand).
2. **Schema-qualified table refs** — `db.selectFrom('tracking.shipments')` everywhere, or set a default
   schema on the Kysely dialect? → qualified refs (explicit, matches the Drizzle schema's intent).
3. **CamelCasePlugin** — keep `CamelCasePlugin({ maintainNestedObjectKeys: true })` from the spike (so TS
   stays camelCase, DB stays snake_case)? → yes (proven in Phase 0; keeps the repo code unchanged).
