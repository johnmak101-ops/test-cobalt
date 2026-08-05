# SQL Server / T-SQL gotchas

_The Postgres habits that break on SQL Server (and Fabric SQL), each with the place in this repo
where it actually bit. Read before writing a migration or a repository query._

The schema source of truth is `backend/src/db/kysely-migrations/*.ts` — hand-written T-SQL, applied by
Kysely's Migrator. Row types are generated (`db.generated.ts`); always import `DB` from
`backend/src/db/kysely/db.ts`, which carries the curated JSON/enum overrides.

## Writing migrations

| Postgres habit | T-SQL here | Where |
|---|---|---|
| `GO` between batches | `-- statement-breakpoint` — **tedious does not understand `GO`** | `src/db/kysely/migrate.ts` |
| `jsonb` | `nvarchar(max)` holding JSON (`JSON_VALUE` / `OPENJSON` to query it) | `0000_init` |
| `uuid` / `gen_random_uuid()` | `uniqueidentifier DEFAULT NEWID()` — values come back **uppercase** | `0000_init` |
| `timestamptz` | `datetimeoffset(7)`, defaulted `SYSDATETIMEOFFSET()` | `0000_init` |
| `bigserial` | `bigint IDENTITY` | `0000_init` |
| `bytea` | `varbinary(max)` | `email_attachment.raw_bytes` |
| `text` + enum | `nvarchar(n)` + a `CHECK (col IN (...))` constraint | every enum column |
| Reserved words | Bracket them: `[key]` | `app_settings` |

Register every new migration in `migrate-cli.ts` — an unregistered file simply never runs.

## Query idioms

| Postgres | T-SQL here |
|---|---|
| `LIMIT n` | `TOP n` (Kysely `.top()`), or `OFFSET … FETCH NEXT` when paginating |
| `RETURNING` | `OUTPUT` — Kysely `.outputAll('inserted')` (~50 call sites) |
| `INSERT … ON CONFLICT DO NOTHING` | **check-then-insert**, catching the unique violation as the idempotent no-op. See `isUniqueViolation` in `src/common/db-errors.ts` and the repository headers that call it out (`alert`, `booking`, `email`) |
| `ILIKE` | `LIKE` — case-insensitivity comes from the collation |
| `TRUNCATE … RESTART IDENTITY CASCADE` | No cascade: `EXEC sp_MSforeachtable 'ALTER TABLE ? NOCHECK CONSTRAINT ALL'`, `DELETE` child→parent, then re-enable `WITH CHECK`. `uniqueidentifier` PKs default via `NEWID()`, so there is no identity to restart (`src/db/seed.ts`, the `SEED_DEMO` rebuild) |

## The ones that cost real time

**Data-type precedence silently coerces.** `uniqueidentifier` outranks `nvarchar`, so
`COALESCE(dedup_key, id)` coerces the *string* column to a GUID and dies with
`Conversion failed … to uniqueidentifier` (Msg 8169) on every matching row. `CONVERT(nvarchar(36), id)`
first. Cost a whole migration run — `0019_retire_alert_rule_pairs`.

**A `UNIQUE` constraint permits exactly one NULL row**, unlike Postgres which permits many. A nullable
"code" column with a unique constraint (`uq_vendors_code`, `uq_forwarders_code`) therefore allows only
one un-coded row. Use a filtered index when several NULLs are legitimate.

**Bounded `nvarchar` truncates loudly and late.** `item_style_no` / `hts_code` are list-typed — they
comma-join every distinct value across a shipment's PO group. A 51-PO booking produced ~600 chars and
the decision commit 500'd with *"String or binary data would be truncated"*. Widened to `nvarchar(max)`
in `0011_shipment_list_fields_widen`. If a column's semantics are "a joined list", give it `nvarchar(max)`.

**Constraint failures reach the client as 500s unless caught.** `DbExceptionFilter` (global) maps
CHECK / unique / NOT NULL violations to a `400` with a non-leaky message. Don't parse the message text
for control flow — it can carry constraint names.

## Test engine

Dev and CI run the **`mssql-2022` container** on `localhost:1433` (sa / `YourStrong!Passw0rd`);
**Fabric SQL is the deploy target**. `backend/test/setup-db.ts` creates and migrates a `cobalt_test`
database on first connect (override with `SQL_SERVER_TEST_URL`). Verify anything Fabric-specific
against a Fabric dev database before deploying — the engines are the same family but not identical.

Before **any** production migration, read the ledger first:

```sql
SELECT name, timestamp FROM kysely_migration ORDER BY name;
```

Background and the decision record: [../architecture/fabric-sql-migration.md](../architecture/fabric-sql-migration.md),
[../architecture/adr-database-platform.md](../architecture/adr-database-platform.md).
