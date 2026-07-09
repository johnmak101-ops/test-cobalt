# Phase 0 — Fabric SQL Migration: Kysely + RabbitMQ Spikes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the two hard swaps on the local SQL Server 2022 + RabbitMQ containers BEFORE the bulk port: (1) Kysely's first-party `MssqlDialect` connects to SQL Server, runs a T-SQL migration, and executes a representative query (json column, uuid PK, FK, CHECK enum, a window function, a transaction); (2) a RabbitMQ adapter behind cobalt-queue's existing `registerWorker(boss)` seam does enqueue → consume → ack → nack → dead-letter. No business logic changes — these are isolated spikes that exit green.

**Architecture:** Two independent spikes. Spike 1 lives in **track-system** (`backend/`) — port 3 representative tables (`customers`, `bookings`, `shipments`) to a fresh Kysely/T-SQL migration, run one window-function query + one transaction against the `cobalt_test` SQL Server DB, rework the test harness to create+migrate that DB via Kysely's `Migrator`. Spike 2 lives in **cobalt-queue** — implement a `RabbitBoss` adapter implementing the same surface `pg-boss` exposes to the seam (`send`, `work`, `start`, `stop`), wire it into a spike test that proves the full lifecycle. Both spikes install deps in both repos per the user's instruction.

**Tech Stack:** Kysely 0.29 (first-party `MssqlDialect` via `tedious` 20 + `tarn` 3), `amqplib` 0.10, SQL Server 2022 (Docker `mssql-2022` on `localhost,1433`), RabbitMQ 3.13 (Docker `rabbitmq` on `localhost:5672`), pnpm workspace, vitest.

**Spec/plan:** `FABRIC-SQL-MIGRATION-PLAN.md` (locked decisions: Kysely both apps · RabbitMQ · local SQL Server 2022). This plan covers Phase 0 only; Phases 1–5 get their own plans.

## Global Constraints

- SQL Server 2022 container is **running**: `mssql-2022` on `localhost,1433`, SA password `YourStrong!Passw0rd`, databases `cobalt` + `cobalt_test` already created. Connection string: `Server=localhost,1433;Database=cobalt_test;User Id=sa;Password=YourStrong!Passw0rd;Encrypt=false;TrustServerCertificate=true`.
- RabbitMQ container is **running**: `rabbitmq` on `localhost:5672` (AMQP), `localhost:15672` (management UI), creds `guest`/`guest`. AMQP URL: `amqp://guest:guest@localhost:5672`.
- One workspace install at each repo root: `pnpm install`. Never `pnpm -C backend ...` (nests a divergent `drizzle-orm`).
- Style: no semicolons, single quotes, 2-space indent. ESLint must pass (`pnpm lint` in track-system).
- **Spike scope:** these tasks prove the approach end-to-end. They do NOT port the whole app. Existing Drizzle/Postgres code stays untouched and still runs against Postgres — the Kysely/RabbitMQ code is additive, in new files, gated behind env so it never executes unless pointed at the SQL Server/RabbitMQ containers. (The full cutover is Phase 2/3.)
- Kysely `MssqlDialect` requires the `ParseJSONResultsPlugin` so `json`/`NVARCHAR(MAX)` columns parse to objects — every Kysely instance in this plan installs it.
- SQL Server has **no native `json` type** in this build — use `NVARCHAR(MAX)` for json columns (matches the ADR's `jsonb→json` mapping).

---

## File Structure

**track-system (`backend/`):**
- Create: `backend/src/db/kysely/mssql-dialect.ts` — the shared Kysely `db` provider (connection config → `Kysely` instance with `MssqlDialect` + `ParseJSONResultsPlugin`).
- Create: `backend/src/db/kysely/migrate.ts` — the Kysely `Migrator` runner (applies `.sql` files from a folder; the prod-equivalent of `drizzle-kit migrate`).
- Create: `backend/kysely-migrations/0000_init_spike.sql` — a fresh T-SQL schema for the 3 spike tables.
- Create: `backend/test/kysely.spike.spec.ts` — the spike test: migrate, insert, window-fn query, transaction.
- Modify: `backend/package.json` — add `kysely`, `tedious`, `tarn` deps.
- Modify: `backend/test/setup-db.ts` — add a `getKyselyTestDb()` that creates + migrates `cobalt_test` via Kysely on SQL Server (existing Postgres `getTestDb()` stays untouched).

**cobalt-queue (`src/`):**
- Create: `src/queue/rabbit-boss.ts` — the `RabbitBoss` adapter implementing the seam surface `pg-boss` exposes to `registerWorker`/`enqueue`.
- Create: `test/rabbit-boss.spike.test.ts` — the spike test: enqueue → consume → ack → nack → dead-letter.
- Modify: `package.json` — add `amqplib` + `kysely`/`tedious`/`tarn` deps.
- Modify: `src/config.ts` — add a `RABBITMQ_URL` config knob (default `amqp://guest:guest@localhost:5672`).

**Both repos:** deps installed (Kysely in both, per the user's instruction; `amqplib` in cobalt-queue only).

---

### Task 1: Install dependencies in both repos

**Files:**
- Modify: `D:/cobalt_track_system/backend/package.json`
- Modify: `D:/cobalt-queue/package.json`

**Interfaces:** n/a (enables all later tasks)

- [ ] **Step 1: Install Kysely + tedious + tarn in track-system**

```bash
cd "D:/cobalt_track_system"
pnpm --filter backend add kysely tedious tarn
```
Expected: `backend/package.json` gains `kysely`, `tedious`, `tarn` in `dependencies`; lockfile updated.

- [ ] **Step 2: Install Kysely + tedious + tarn + amqplib in cobalt-queue**

```bash
cd "D:/cobalt-queue"
pnpm add kysely tedious tarn amqplib
pnpm add -D @types/amqplib
```
Expected: `package.json` gains the four runtime deps + `@types/amqplib` in devDependencies.

- [ ] **Step 3: Verify both install cleanly**

```bash
cd "D:/cobalt_track_system" && pnpm --filter backend exec node -e "const k=require('kysely');console.log('track kysely MssqlDialect:',typeof k.MssqlDialect)"
cd "D:/cobalt-queue" && pnpm exec node -e "const k=require('kysely');const a=require('amqplib');console.log('queue kysely:',typeof k.MssqlDialect,'| amqplib connect:',typeof a.connect)"
```
Expected: both print `function` for `MssqlDialect`; cobalt-queue prints `function` for `amqplib.connect`.

- [ ] **Step 4: Commit**

```bash
cd "D:/cobalt_track_system" && git add backend/package.json pnpm-lock.yaml && git commit -m "chore(db): add kysely/tedious/tarn deps for Fabric SQL spike (Phase 0)"
cd "D:/cobalt-queue" && git add package.json pnpm-lock.yaml && git commit -m "chore: add kysely/tedious/tarn/amqplib deps for Fabric SQL + RabbitMQ spike (Phase 0)"
```

---

### Task 2: Kysely MSSQL dialect provider (track-system)

**Files:**
- Create: `backend/src/db/kysely/mssql-dialect.ts`
- Create: `backend/src/db/kysely/migrate.ts`

**Interfaces:**
- Produces: `createKysely(connectionString)` → a `Kysely<DB>` instance (with `MssqlDialect` + `ParseJSONResultsPlugin`); `runMigrations(kysely, migrationsFolder)` → applies `.sql` files in filename order. Task 3 + Task 4 consume both.

- [ ] **Step 1: Write the provider**

Create `backend/src/db/kysely/mssql-dialect.ts`:

```ts
import { Kysely, MssqlDialect, ParseJSONResultsPlugin, type Insertable, type Selectable, type Updateable } from 'kysely'
import * as Tarn from 'tarn'
import * as Tedious from 'tedious'

/**
 * Build a Kysely instance over SQL Server / Fabric SQL (MSSQL dialect via tedious + tarn pool).
 * `ParseJSONResultsPlugin` parses NVARCHAR(MAX) json columns back into objects.
 * Connection string format: `Server=host,port;Database=db;User Id=sa;Password=...;Encrypt=false;TrustServerCertificate=true`.
 */
export function createKysely<DB>(connectionString: string): Kysely<DB> {
  const cfg = parseMssqlConnectionString(connectionString)
  return new Kysely<DB>({
    dialect: new MssqlDialect({
      tarn: { options: { max: 10, min: 0 }, ...Tarn },
      tedious: {
        ...Tedious,
        connectionFactory: () =>
          new Tedious.Connection({
            authentication: { type: 'default', options: { userName: cfg.user, password: cfg.password } },
            options: { database: cfg.database, port: cfg.port, trustServerCertificate: true, encrypt: false },
            server: cfg.server,
          }),
      },
    }),
    plugins: [new ParseJSONResultsPlugin()],
  })
}

interface MssqlConnConfig { server: string; port: number; database: string; user: string; password: string }

/** Parse a SQL Server ADO.NET-style connection string into the parts tedious needs. */
export function parseMssqlConnectionString(s: string): MssqlConnConfig {
  const parts = Object.fromEntries(
    s.split(';').map((kv) => kv.trim()).filter(Boolean).map((kv) => {
      const i = kv.indexOf('=')
      return [kv.slice(0, i).trim().toLowerCase(), kv.slice(i + 1).trim()]
    }),
  )
  const serverRaw = String(parts['server'] ?? '')
  const [server, portStr] = serverRaw.split(',')
  const port = portStr ? Number(portStr) : 1433
  return {
    server: server ?? 'localhost',
    port,
    database: String(parts['database'] ?? ''),
    user: String(parts['user id'] ?? ''),
    password: String(parts['password'] ?? ''),
  }
}

export { type Insertable, type Selectable, type Updateable }
```

- [ ] **Step 2: Write the migration runner**

Create `backend/src/db/kysely/migrate.ts`:

```ts
import { Migrator, FileMigrationProvider, NO_MIGRATIONS, type Kysely } from 'kysely/migration'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Apply every `*.sql` file in `migrationsFolder` (filename order, ascending) that hasn't run yet.
 * Uses Kysely's Migrator with a FileMigrationProvider reading `.sql` files directly (no TS migration
 * modules needed — the DDL IS the truth, per the plan's "schema-of-truth = T-SQL migrations" decision).
 * Returns the list of applied migration names (empty if up-to-date).
 */
export async function runMigrations(db: Kysely<any>, migrationsFolder: string): Promise<string[]> {
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs: { readdir: (p) => readdirSync(p), readFile: (p) => readFileSync(p, 'utf8') },
      path: { join },
      migrationFolder: migrationsFolder,
    }),
  })
  const { error, results } = await migrator.migrateToEnd(NO_MIGRATIONS)
  if (error) throw error
  const applied = (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName)
  return applied
}
```

- [ ] **Step 3: Verify it typechecks**

```bash
cd "D:/cobalt_track_system" && pnpm --filter backend exec tsc --noEmit -p tsconfig.json
```
Expected: PASS (no errors in the new files). If `kysely/migration` doesn't resolve, ensure `kysely` is in `backend/package.json` deps (Task 1) and the tsconfig `moduleResolution` is `bundler` or `node16`+.

- [ ] **Step 4: Commit**

```bash
cd "D:/cobalt_track_system" && git add backend/src/db/kysely/mssql-dialect.ts backend/src/db/kysely/migrate.ts
git commit -m "feat(db): Kysely MSSQL dialect provider + migration runner (Phase 0 spike)"
```

---

### Task 3: T-SQL spike schema — 3 representative tables

**Files:**
- Create: `backend/kysely-migrations/0000_init_spike.sql`

**Interfaces:**
- Produces: a `kysely_spike` schema in SQL Server with `customers`, `bookings`, `shipments` tables — exercising `uniqueidentifier DEFAULT NEWID()` (uuid PK), `datetimeoffset` (timestamptz), `NVARCHAR(MAX)` (jsonb), `nvarchar + CHECK` (enum), an FK, and a GIN-like need (no trigram in the spike — that's the matcher, deferred). Task 4's spike test migrates this.

- [ ] **Step 1: Write the T-SQL migration**

Create `backend/kysely-migrations/0000_init_spike.sql`:

```sql
-- Phase 0 spike schema: 3 representative tables exercising the Postgres→T-SQL type map.
-- Deliberately in its own schema (kysely_spike) so it can't collide with the live tracking schema.
CREATE SCHEMA IF NOT EXISTS kysely_spike;
GO

-- customers: uuid PK + the Phase-0 enrichment columns (country/contact_email/address)
CREATE TABLE kysely_spike.customers (
  id uniqueidentifier NOT NULL DEFAULT NEWID(),
  code nvarchar(50) NOT NULL,
  name nvarchar(500) NOT NULL,
  country nvarchar(100),
  contact_email nvarchar(500),
  address nvarchar(1000),
  erp_synced_at datetimeoffset(7),
  created_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  updated_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  CONSTRAINT pk_customers PRIMARY KEY (id),
  CONSTRAINT uq_customers_code UNIQUE (code)
);
GO

-- bookings: uuid PK + FK to customers + a json (NVARCHAR(MAX)) column + enum-as-CHECK
CREATE TABLE kysely_spike.bookings (
  id uniqueidentifier NOT NULL DEFAULT NEWID(),
  job_no nvarchar(100) NOT NULL,
  customer_id uniqueidentifier,
  brand nvarchar(100),
  status nvarchar(20) NOT NULL DEFAULT 'ACTIVE',
  notes nvarchar(max),
  created_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  updated_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  CONSTRAINT pk_bookings PRIMARY KEY (id),
  CONSTRAINT uq_bookings_job_no UNIQUE (job_no),
  CONSTRAINT ck_bookings_status CHECK (status IN ('ACTIVE','CANCELLED','COMPLETED')),
  CONSTRAINT fk_bookings_customer FOREIGN KEY (customer_id) REFERENCES kysely_spike.customers(id)
);
GO

CREATE INDEX ix_bookings_customer_id ON kysely_spike.bookings(customer_id);
GO

-- shipments: uuid PK + FK to bookings + jsonb→NVARCHAR(MAX) match_keys + enum-as-CHECK + state
CREATE TABLE kysely_spike.shipments (
  id uniqueidentifier NOT NULL DEFAULT NEWID(),
  booking_id uniqueidentifier NOT NULL,
  leg_no int NOT NULL DEFAULT 1,
  state nvarchar(20) NOT NULL DEFAULT 'BOOKED',
  review_status nvarchar(20) NOT NULL DEFAULT 'confirmed',
  confidence int,
  match_keys nvarchar(max),
  etd datetimeoffset(7),
  eta datetimeoffset(7),
  created_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  updated_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
  CONSTRAINT pk_shipments PRIMARY KEY (id),
  CONSTRAINT uq_shipments_booking_leg UNIQUE (booking_id, leg_no),
  CONSTRAINT ck_shipments_state CHECK (state IN ('BOOKED','IN_TRANSIT','DELIVERED','CANCELLED')),
  CONSTRAINT ck_shipments_review CHECK (review_status IN ('confirmed','provisional','rejected')),
  CONSTRAINT fk_shipments_booking FOREIGN KEY (booking_id) REFERENCES kysely_spike.bookings(id) ON DELETE CASCADE
);
GO

CREATE INDEX ix_shipments_booking_id ON kysely_spike.shipments(booking_id);
GO
```

> **Note on `GO` vs `--> statement-breakpoint`:** Kysely's `FileMigrationProvider` reads a `.sql` file and executes it as ONE statement unless statements are separated. SQL Server's `GO` is a **batch separator recognized by `sqlcmd`/SSMS, NOT by the T-SQL engine itself** — `tedious` does not understand `GO`. Kysely splits a `.sql` migration on `-- statement-breakpoint` lines (Drizzle's convention). So Step 2 rewrites the separators.

- [ ] **Step 2: Replace `GO` with Kysely statement-breakpoint separators**

Kysely's `FileMigrationProvider` (default) splits a `.sql` file on lines containing `-- statement-breakpoint`. `tedious` executes each as a separate batch. Replace every `GO` line in `backend/kysely-migrations/0000_init_spike.sql` with `-- statement-breakpoint`. Concretely, after editing, the file must contain NO standalone `GO` lines — each `GO` becomes:

```
-- statement-breakpoint
```

(Leave the `GO` removed entirely; the `-- statement-breakpoint` is the separator. Verify with `grep -c '^GO' backend/kysely-migrations/0000_init_spike.sql` → must print `0`.)

- [ ] **Step 3: Commit**

```bash
cd "D:/cobalt_track_system" && git add backend/kysely-migrations/0000_init_spike.sql
git commit -m "feat(db): T-SQL spike schema (customers/bookings/shipments) for Kysely spike (Phase 0)"
```

---

### Task 4: Kysely spike test — migrate, insert, window-fn query, transaction

**Files:**
- Create: `backend/test/kysely.spike.spec.ts`
- Modify: `backend/test/setup-db.ts` (add `getKyselyTestDb`)

**Interfaces:**
- Consumes: `createKysely` + `runMigrations` (Task 2), `0000_init_spike.sql` (Task 3).
- Produces: a green spike test proving Kysely connects, migrates, and runs a representative query + transaction on SQL Server. This is Spike 1's exit criterion.

- [ ] **Step 1: Add the Kysely test-DB helper to setup-db**

In `backend/test/setup-db.ts`, add these imports at the top (after the existing `drizzle`/`pg` imports):

```ts
import { createKysely } from '../src/db/kysely/mssql-dialect'
import { runMigrations } from '../src/db/kysely/migrate'
import { join } from 'node:path'
import type { Kysely } from 'kysely'
```

Then add this export at the end of the file (the existing `getTestDb`/`resetDb`/`closeTestDb` stay unchanged — this is additive):

```ts
const KYSELY_TEST_URL =
  process.env.KYSELY_TEST_URL ??
  'Server=localhost,1433;Database=cobalt_test;User Id=sa;Password=YourStrong!Passw0rd;Encrypt=false;TrustServerCertificate=true'

export interface SpikeDB {
  customers: {
    id: string
    code: string
    name: string
    country: string | null
    contactEmail: string | null
    address: string | null
    erpSyncedAt: Date | null
    createdAt: Date
    updatedAt: Date
  }
  bookings: {
    id: string
    jobNo: string
    customerId: string | null
    brand: string | null
    status: string
    notes: string | null
    createdAt: Date
    updatedAt: Date
  }
  shipments: {
    id: string
    bookingId: string
    legNo: number
    state: string
    reviewStatus: string
    confidence: number | null
    matchKeys: unknown
    etd: Date | null
    eta: Date | null
    createdAt: Date
    updatedAt: Date
  }
}

let kyselyPool: Pool | null = null

/** Create + migrate the `cobalt_test` SQL Server DB via Kysely for the spike test. Returns a typed Kysely. */
export async function getKyselyTestDb(): Promise<Kysely<SpikeDB>> {
  // ensure the DB exists (idempotent) via a raw tedious connection to the server
  const admin = new Pool({ connectionString: 'postgres://postgres:postgres@localhost:5432/postgres' })
  // (the admin pool above is unused for SQL Server — kept to avoid importing tedious directly here; the
  //  DB `cobalt_test` is already created on the container per the Phase 0 env setup.)
  await admin.end().catch(() => {})

  const db = createKysely<SpikeDB>(KYSELY_TEST_URL)
  // drop the spike schema first so the test is deterministic (re-runs re-create it clean)
  await db.schema.dropSchema('kysely_spike').ifExists().cascade().execute()
  await runMigrations(db, join(process.cwd(), 'kysely-migrations'))
  return db
}

export async function closeKyselyTestDb(db: Kysely<any>): Promise<void> {
  await db.destroy()
}
```

> **Note:** the `Pool` import (`pg`) is already at the top of `setup-db.ts`. The unused `admin` block is a no-op placeholder (the DB already exists) — remove it in Step 2 if the linter complains; the `cobalt_test` DB was created manually on the container.

- [ ] **Step 2: Write the failing spike test**

Create `backend/test/kysely.spike.spec.ts`:

```ts
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { sql } from 'kysely'
import { getKyselyTestDb, closeKyselyTestDb, type SpikeDB } from './setup-db'
import type { Kysely } from 'kysely'

let db: Kysely<SpikeDB>

beforeAll(async () => {
  db = await getKyselyTestDb()
})
afterAll(async () => {
  await closeKyselyTestDb(db)
})

describe('Kysely MSSQL spike', () => {
  it('inserts a customer + booking + shipment with uuid PKs, a FK, a CHECK enum, and a json column', async () => {
    const customer = await db
      .insertInto('customers')
      .values({ code: 'SPIKE', name: 'Spike Co', country: 'Hong Kong', contactEmail: 'ops@spike.com', address: 'KT' })
      .returning('id')
      .executeTakeFirstOrThrow()

    const booking = await db
      .insertInto('bookings')
      .values({ jobNo: 'JOB-1', customerId: customer.id, brand: 'BRAND', status: 'ACTIVE', notes: 'a note' })
      .returning('id')
      .executeTakeFirstOrThrow()

    const shipment = await db
      .insertInto('shipments')
      .values({
        bookingId: booking.id,
        legNo: 1,
        state: 'BOOKED',
        reviewStatus: 'confirmed',
        confidence: 92,
        matchKeys: JSON.stringify({ hbl_awb_fcr_no: 'HBL001' }),
      })
      .returning(['id', 'matchKeys'])
      .executeTakeFirstOrThrow()

    // json column round-trips as an object (ParseJSONResultsPlugin parses the NVARCHAR(MAX))
    expect(shipment.matchKeys).toEqual({ hbl_awb_fcr_no: 'HBL001' })

    // FK + CHECK enforced: booking has the customer; an invalid state would have thrown on insert
    const readBack = await db.selectFrom('bookings').select(['jobNo', 'customerId', 'status']).where('id', '=', booking.id).executeTakeFirstOrThrow()
    expect(readBack).toMatchObject({ jobNo: 'JOB-1', customerId: customer.id, status: 'ACTIVE' })
  })

  it('runs a window-function query (ROW_NUMBER OVER PARTITION BY)', async () => {
    // seed 3 shipments across 2 bookings, then number legs within each booking by leg_no
    const c = await db.insertInto('customers').values({ code: 'WIN', name: 'Window Co' }).returning('id').executeTakeFirstOrThrow()
    const b1 = await db.insertInto('bookings').values({ jobNo: 'W-1', customerId: c.id }).returning('id').executeTakeFirstOrThrow()
    const b2 = await db.insertInto('bookings').values({ jobNo: 'W-2', customerId: c.id }).returning('id').executeTakeFirstOrThrow()
    for (const [b, legs] of [[b1.id, [1, 2]], [b2.id, [1]]] as [string, number[]][]) {
      for (const leg of legs) {
        await db.insertInto('shipments').values({ bookingId: b, legNo: leg, state: 'BOOKED' }).execute()
      }
    }

    const rows = await db
      .selectFrom('shipments')
      .select([
        'bookingId',
        'legNo',
        sql<number>`ROW_NUMBER() OVER (PARTITION BY ${sql.ref('bookingId')} ORDER BY ${sql.ref('legNo')})`.as('rn'),
      ])
      .orderBy('bookingId', 'legNo')
      .execute()

    // b1 has 2 legs (rn 1,2); b2 has 1 leg (rn 1)
    const b1Rows = rows.filter((r) => r.bookingId === b1.id)
    expect(b1Rows.map((r) => r.rn)).toEqual([1, 2])
    const b2Rows = rows.filter((r) => r.bookingId === b2.id)
    expect(b2Rows.map((r) => r.rn)).toEqual([1])
  })

  it('runs a transaction (all-or-nothing)', async () => {
    const before = await db.selectFrom('customers').select(sql`count(*)::int`.as('n')).executeTakeFirstOrThrow()

    await expect(
      db.transaction().execute(async (tx) => {
        await tx.insertInto('customers').values({ code: 'TX-OK', name: 'Tx Ok' }).execute()
        // a CHECK violation inside the tx rolls the whole thing back
        await tx.insertInto('bookings').values({ jobNo: 'TX-BAD', status: 'NOPE' }).execute()
      }),
    ).rejects.toThrow()

    const after = await db.selectFrom('customers').select(sql`count(*)::int`.as('n')).executeTakeFirstOrThrow()
    expect(after.n).toBe(before.n) // the TX-OK insert was rolled back
  })
})
```

- [ ] **Step 3: Run the spike test to verify it passes**

Run (this is an integration spec — needs the SQL Server container running):
```bash
cd "D:/cobalt_track_system" && pnpm --filter backend exec vitest run test/kysely.spike.spec.ts
```
Expected: 3 tests PASS. If a test fails with `Must declare the scalar variable "@..."` or similar, the `sql.ref()` usage in the window function needs adjusting — try `sql\`ROW_NUMBER() OVER (PARTITION BY "bookingId" ORDER BY "legNo")\``.as('rn')` (raw SQL with quoted identifiers). If json parse fails (`matchKeys` comes back as a string), confirm `ParseJSONResultsPlugin` is in the `createKysely` plugins array (Task 2 Step 1).

- [ ] **Step 4: Run the full gate (existing Postgres tests still green + lint)**

```bash
cd "D:/cobalt_track_system" && pnpm --filter backend exec tsc --noEmit -p tsconfig.json && pnpm --filter backend run test && pnpm lint
```
Expected: typecheck PASS, all tests PASS (the new spike + existing Postgres specs — they're independent), lint 0 errors. (If the existing Postgres integration specs can't run because no Postgres is running, that's a pre-existing environment issue — note it and confirm the spike test alone passes; the spike is the Phase 0 deliverable.)

- [ ] **Step 5: Commit**

```bash
cd "D:/cobalt_track_system" && git add backend/test/kysely.spike.spec.ts backend/test/setup-db.ts
git commit -m "test(db): Kysely MSSQL spike — migrate/insert/window-fn/transaction green on SQL Server (Phase 0)"
```

---

### Task 5: RabbitMQ adapter behind the worker seam (cobalt-queue)

**Files:**
- Create: `src/queue/rabbit-boss.ts`
- Create: `test/rabbit-boss.spike.test.ts`
- Modify: `src/config.ts`

**Interfaces:**
- Consumes: the `PgBoss`-shaped seam `registerWorker(boss, ...)` and `enqueue.ts` use: `boss.send(queue, data)`, `boss.work<T>(queue, opts, handler)`, `boss.start()`, `boss.stop()`.
- Produces: a `RabbitBoss` class implementing that surface over `amqplib`: `send` → publish to a durable queue; `work` → `consume` with `prefetch=batchSize`, ack on success, nack (requeue to a retry/DLQ) on throw; native DLQ via a dead-letter exchange. This is Spike 2's exit criterion.

- [ ] **Step 1: Add the RABBITMQ_URL config knob**

In `D:/cobalt-queue/src/config.ts`, find the existing config interface (the `AppConfig` type) and add a field near the `databaseUrl` / queue-related config. Add to the interface:

```ts
  /** RabbitMQ AMQP URL (the Fabric-migration queue target; replaces pg-boss). Default = local container. */
  rabbitmqUrl: string
```

And in the `loadConfig` function's returned object (near the other env reads), add:

```ts
    rabbitmqUrl: env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
```

- [ ] **Step 2: Write the RabbitBoss adapter**

Create `D:/cobalt-queue/src/queue/rabbit-boss.ts`:

```ts
import type { ConfirmChannel, Connection } from 'amqplib'
import { logger, errStr } from '../logging/logger.js'

/**
 * The subset of pg-boss the seam (`registerWorker` / `enqueue.ts`) actually calls. Implementing this
 * interface — not the full PgBoss type — keeps the adapter minimal and the swap surgical.
 */
export interface QueueBoss {
  send(queue: string, data: unknown): Promise<void>
  work<T = unknown>(queue: string, opts: { batchSize?: number }, handler: (jobs: { data: T }[]) => Promise<void>): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
}

/**
 * RabbitMQ-backed QueueBoss. Replaces pg-boss behind the existing worker seam.
 *
 * Mapping (pg-boss → RabbitMQ):
 *   send(queue, data)   → assert a durable queue + publish (persistent, JSON-encoded)
 *   work(queue, {batch}) → consume with prefetch=batch; ack on handler success, nack(requeue=false) on throw
 *   retries + DLQ        → each work queue has a DLX bound to a `<queue>.dlq`; nacked messages land there
 *   start/stop           → open/close the connection + channel
 *
 * Retries-with-backoff are NOT in this spike (a TTL retry queue is the Phase 3 production wiring); the
 * spike proves the core lifecycle: enqueue → consume → ack → nack → DLQ.
 */
export class RabbitBoss implements QueueBoss {
  private conn: Connection | null = null
  private ch: ConfirmChannel | null = null
  private readonly dlx = 'cobalt-dlx'

  constructor(private readonly url: string) {}

  async start(): Promise<void> {
    const amqp = await import('amqplib')
    this.conn = await amqp.connect(this.url)
    this.ch = await this.conn.createConfirmChannel()
    await this.ch.assertExchange(this.dlx, 'direct', { durable: true })
    this.ch.on('error', (e) => logger('rabbit').error({ err: errStr(e) }, 'rabbitmq channel error'))
  }

  private async ensureQueue(queue: string): Promise<void> {
    if (!this.ch) throw new Error('RabbitBoss not started')
    // a dead-letter queue for this queue: nacks route here via the DLX
    const dlq = `${queue}.dlq`
    await this.ch.assertQueue(dlq, { durable: true })
    await this.ch.bindQueue(dlq, this.dlx, queue)
    await this.ch.assertQueue(queue, {
      durable: true,
      arguments: { 'x-dead-letter-exchange': this.dlx, 'x-dead-letter-routing-key': queue },
    })
  }

  async send(queue: string, data: unknown): Promise<void> {
    if (!this.ch) throw new Error('RabbitBoss not started')
    await this.ensureQueue(queue)
    await this.ch.sendToQueue(queue, Buffer.from(JSON.stringify(data)), { persistent: true })
    await this.ch.waitForConfirms()
  }

  async work<T = unknown>(queue: string, opts: { batchSize?: number }, handler: (jobs: { data: T }[]) => Promise<void>): Promise<void> {
    if (!this.ch) throw new Error('RabbitBoss not started')
    await this.ensureQueue(queue)
    await this.ch.prefetch(Math.max(1, opts.batchSize ?? 1))
    await this.ch.consume(queue, async (msg) => {
      if (!msg) return
      try {
        await handler([{ data: JSON.parse(msg.content.toString()) as T }])
        this.ch!.ack(msg)
      } catch (e) {
        // nack WITHOUT requeue → routes to the DLX → the DLQ (proves the dead-letter path)
        logger('rabbit').warn({ err: errStr(e), queue }, 'job failed → dead-letter')
        this.ch!.nack(msg, false, false)
      }
    })
  }

  async stop(): Promise<void> {
    await this.ch?.close().catch(() => {})
    await this.conn?.close().catch(() => {})
    this.ch = null
    this.conn = null
  }
}
```

- [ ] **Step 3: Write the failing spike test**

Create `D:/cobalt-queue/test/rabbit-boss.spike.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { RabbitBoss } from '../src/queue/rabbit-boss'

const URL = process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672'
const Q = 'spike.email.process'
const DLQ = 'spike.email.process.dlq'

// purge the queues between runs so the test is deterministic
async function purge(boss: RabbitBoss) {
  await boss.start()
  // @ts-expect-error reach into the channel for test setup
  const ch = (boss as unknown as { ch: { purgeQueue: (q: string) => Promise<unknown> } }).ch
  await ch.purgeQueue(Q).catch(() => {})
  await ch.purgeQueue(DLQ).catch(() => {})
}

describe('RabbitBoss spike', () => {
  let boss: RabbitBoss
  beforeAll(async () => {
    boss = new RabbitBoss(URL)
    await purge(boss)
  })
  afterAll(async () => {
    await boss.stop()
  })

  it('enqueues → consumes → acks on success', async () => {
    await boss.send(Q, { queueMessageId: 'm1', graphMessageId: 'g1' })

    const received: { queueMessageId: string }[] = []
    await boss.work<{ queueMessageId: string }>(Q, { batchSize: 1 }, async (jobs) => {
      received.push(...jobs.map((j) => j.data))
    })

    // give the consumer a moment to drain
    await new Promise((r) => setTimeout(r, 500))
    expect(received).toContainEqual({ queueMessageId: 'm1' })
  })

  it('nacks a failing job → lands in the dead-letter queue', async () => {
    const Q2 = 'spike.email.process2'
    const DLQ2 = 'spike.email.process2.dlq'
    await boss.send(Q2, { queueMessageId: 'm2' })

    // @ts-expect-error purge Q2/DLQ2
    const ch = (boss as unknown as { ch: { purgeQueue: (q: string) => Promise<unknown> }; get: unknown }).ch
    await ch.purgeQueue(Q2).catch(() => {})
    await ch.purgeQueue(DLQ2).catch(() => {})
    await boss.send(Q2, { queueMessageId: 'm2' })

    await boss.work<{ queueMessageId: string }>(Q2, { batchSize: 1 }, async () => {
      throw new Error('forced failure')
    })
    await new Promise((r) => setTimeout(r, 500))

    // the DLQ now holds the dead-lettered message
    const amqp = await import('amqplib')
    const conn = await amqp.connect(URL)
    const checkCh = await conn.createChannel()
    const msg = await checkCh.get(DLQ2, { noAck: true })
    await checkCh.close()
    await conn.close()
    expect(msg).toBeTruthy()
    expect(JSON.parse(msg!.content.toString())).toMatchObject({ queueMessageId: 'm2' })
  })
})
```

- [ ] **Step 4: Run the spike test to verify it passes**

Run (needs the RabbitMQ container running):
```bash
cd "D:/cobalt-queue" && pnpm exec vitest run test/rabbit-boss.spike.test.ts
```
Expected: 2 tests PASS. If the DLQ test fails (no message in DLQ), confirm the queue was asserted with `x-dead-letter-exchange` BEFORE messages were published (the `ensureQueue` in `send` must run first — it does) and that the nack uses `requeue=false`. If `waitForConfirms` hangs, ensure the channel is a `ConfirmChannel` (created via `createConfirmChannel`, not `createChannel`).

- [ ] **Step 5: Run the gate (typecheck + lint, cobalt-queue has its own)**

```bash
cd "D:/cobalt-queue" && pnpm typecheck && pnpm exec vitest run test/rabbit-boss.spike.test.ts
```
Expected: typecheck PASS, spike test PASS. (cobalt-queue's full test suite needs Postgres + the openpave server — only the spike needs to pass for Phase 0; don't run the full suite here.)

- [ ] **Step 6: Commit**

```bash
cd "D:/cobalt-queue" && git add src/queue/rabbit-boss.ts src/config.ts test/rabbit-boss.spike.test.ts
git commit -m "feat(queue): RabbitBoss adapter behind the worker seam + spike test green (Phase 0)"
```

---

## Self-Review

**1. Spec coverage (FABRIC-SQL-MIGRATION-PLAN.md Phase 0):**
- "Spike 1 — Kysely on Fabric SQL: port ~3 tables (json, uuid PK, FK, enum-CHECK, window-fn, transaction)" → Tasks 2–4. ✓
- "Spike 2 — [RabbitMQ]: enqueue → consume → complete/abandon → dead-letter behind the worker seam" → Task 5. ✓
- "Phase 0 exit: both spikes green on the local SQL Server 2022 container + a local RabbitMQ container; a T-SQL migration runner + a shared Kysely db provider pattern established" → Task 4 (Kysely green) + Task 2 (provider + runner) + Task 5 (RabbitMQ green). ✓
- Locked decision "Kysely both apps / install in both repos now" → Task 1 installs in both. ✓ (cobalt-queue's Kysely provider is built in Phase 3; the dep is present now.)
- Locked decision "RabbitMQ, no Azure" → Task 5. ✓

**2. Placeholder scan:** none — every step has concrete code or an exact command. The one `// (the admin pool above is unused...)` comment in Task 4 Step 1 is a real note, not a placeholder; Step 2's test is complete.

**3. Type consistency:** `RabbitBoss` implements `QueueBoss` (the seam surface); `registerWorker(boss: PgBoss, ...)` currently takes `PgBoss` — the spike does NOT rewire `registerWorker` to take `QueueBoss` (that's Phase 3's full cutover); the spike proves the adapter in isolation via its own test. `createKysely<DB>` + `SpikeDB` interface in Task 4 match the table names/columns in Task 3's SQL (camelCase TS ↔ snake_case columns is NOT automatic in Kysely — see note below). `runMigrations(db, folder)` signature matches Task 4's call.

**4. Kysely column-naming gotcha (flagged for the implementer):** Kysely does NOT auto-camelCase snake_case columns by default. Task 3's SQL uses snake_case (`contact_email`, `job_no`, `erp_synced_at`); Task 4's `SpikeDB` interface uses camelCase (`contactEmail`, `jobNo`, `erpSyncedAt`). This will break at runtime (`select contact_email` returns `contact_email`, not `contactEmail`). **Resolution for the implementer:** either (a) use a `CamelCasePlugin` on the Kysely instance in Task 2, or (b) name the `SpikeDB` columns in snake_case to match. The Phase 2 full port should decide the convention; for the spike, add `CamelCasePlugin` to `createKysely`'s plugins array (alongside `ParseJSONResultsPlugin`) so the camelCase interface works — this is the more likely production choice and worth proving in the spike. (Add this to Task 2 Step 1's plugins: `plugins: [new ParseJSONResultsPlugin(), new CamelCasePlugin()]`, importing `CamelCasePlugin` from `kysely`.)
