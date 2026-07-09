import { Pool } from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import * as schema from '../src/db/contracts'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { MastersRepository } from '../src/db/repositories/masters.repository'
import { BookingRepository } from '../src/db/repositories/booking.repository'
import { PurchaseOrderRepository } from '../src/db/repositories/purchase-order.repository'
import { ShipmentRepository } from '../src/db/repositories/shipment.repository'
import { FieldLockRepository } from '../src/db/repositories/field-lock.repository'
import { AuditRepository } from '../src/db/repositories/audit.repository'
import { AlertRepository } from '../src/db/repositories/alert.repository'
import { EvidenceRepository } from '../src/db/repositories/evidence.repository'
import { UsersRepository } from '../src/db/repositories/users.repository'
import { SettingsRepository } from '../src/db/repositories/settings.repository'
import { IngestRepository } from '../src/db/repositories/ingest.repository'

const ADMIN_URL = process.env.TEST_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres'
const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/cobalt_test'

export type TestDB = NodePgDatabase<typeof schema>

let pool: Pool | null = null

/** Lazily create + migrate a dedicated `cobalt_test` database (separate from dev data). */
export async function getTestDb(): Promise<{ db: TestDB; pool: Pool }> {
  if (pool) return { db: drizzle(pool, { schema }), pool }
  const admin = new Pool({ connectionString: ADMIN_URL })
  if ((await admin.query("select 1 from pg_database where datname = 'cobalt_test'")).rowCount === 0)
    await admin.query('create database cobalt_test')

  let p = new Pool({ connectionString: TEST_URL })
  const dbName = (await p.query('select current_database() as db')).rows[0].db as string
  const hasLedger = (await p.query("select to_regclass('public._test_migrations') as t")).rows[0].t != null
  const hasSchema = ((await p.query("select 1 from information_schema.schemata where schema_name = 'tracking'")).rowCount ?? 0) > 0
  // Transition: a pre-ledger test DB (its schema was built by the old apply-once path) → recreate it clean ONCE
  // so the migration ledger below becomes the single source of truth. Guarded to a DB literally named
  // `cobalt_test` (never a mispointed real DB) and race-free (int specs run serially, fileParallelism:false).
  if (hasSchema && !hasLedger && dbName === 'cobalt_test') {
    await p.end()
    await admin.query('drop database cobalt_test')
    await admin.query('create database cobalt_test')
    p = new Pool({ connectionString: TEST_URL })
  }
  await admin.end()

  // Apply only migrations not yet recorded, and record each — so a NEWLY-ADDED migration auto-applies on the
  // next run with NO manual `DROP DATABASE cobalt_test`. (The old code skipped ALL migrations whenever the
  // `tracking` schema already existed, so a new migration silently never ran → the tests saw a stale schema.)
  await p.query(
    'create table if not exists _test_migrations (filename text primary key, applied_at timestamptz not null default now())',
  )
  const applied = new Set((await p.query('select filename from _test_migrations')).rows.map((row) => row.filename as string))
  const dir = join(process.cwd(), 'drizzle')
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue
    await p.query(readFileSync(join(dir, file), 'utf8'))
    await p.query('insert into _test_migrations (filename) values ($1)', [file])
  }
  pool = p
  return { db: drizzle(pool, { schema }), pool }
}

export async function resetDb(db: TestDB) {
  await db.execute(sql`truncate table
    tracking.shipment_pos, tracking.shipment_milestones, tracking.shipments,
    tracking.booking_pos, tracking.bookings, tracking.purchase_orders,
    tracking.field_locks, tracking.app_settings, tracking.forwarder_aliases, tracking.consignees,
    tracking.forwarders, tracking.vendors, tracking.customers, tracking.ports,
    audit.change_log,
    alerts.alerts, alerts.alert_rules, tracking.users, tracking.refresh_tokens,
    ingest.parsed_record, ingest.email_attachment, ingest.email_message, ingest.ingest_state
    restart identity cascade`)
}

export async function closeTestDb() {
  if (pool) {
    await pool.end()
    pool = null
  }
}

/** Construct all repositories over a test db (specs build services from these). */
export function repos(db: TestDB) {
  return {
    masters: new MastersRepository(db),
    booking: new BookingRepository(db),
    purchaseOrder: new PurchaseOrderRepository(db),
    shipment: new ShipmentRepository(db),
    fieldLock: new FieldLockRepository(db),
    audit: new AuditRepository(db),
    alert: new AlertRepository(db),
    evidence: new EvidenceRepository(db),
    users: new UsersRepository(db),
    settings: new SettingsRepository(db),
    ingest: new IngestRepository(db),
  }
}
