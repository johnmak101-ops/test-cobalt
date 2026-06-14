import { Pool } from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@cobalt/contracts'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { MastersRepository } from '../src/db/repositories/masters.repository'
import { BookingRepository } from '../src/db/repositories/booking.repository'
import { ShipmentRepository } from '../src/db/repositories/shipment.repository'
import { FieldLockRepository } from '../src/db/repositories/field-lock.repository'
import { AuditRepository } from '../src/db/repositories/audit.repository'
import { AlertRepository } from '../src/db/repositories/alert.repository'
import { EvidenceRepository } from '../src/db/repositories/evidence.repository'

const ADMIN_URL = process.env.TEST_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres'
const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/cobalt_test'

export type TestDB = NodePgDatabase<typeof schema>

let pool: Pool | null = null

/** Lazily create + migrate a dedicated `cobalt_test` database (separate from dev data). */
export async function getTestDb(): Promise<{ db: TestDB; pool: Pool }> {
  if (pool) return { db: drizzle(pool, { schema }), pool }
  const admin = new Pool({ connectionString: ADMIN_URL })
  const r = await admin.query("select 1 from pg_database where datname = 'cobalt_test'")
  if (r.rowCount === 0) await admin.query('create database cobalt_test')
  await admin.end()

  pool = new Pool({ connectionString: TEST_URL })
  const present = await pool.query("select 1 from information_schema.schemata where schema_name = 'tracking'")
  if (present.rowCount === 0) {
    const dir = join(process.cwd(), '..', 'packages', 'contracts', 'drizzle')
    const file = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()[0]
    await pool.query(readFileSync(join(dir, file), 'utf8'))
  }
  return { db: drizzle(pool, { schema }), pool }
}

export async function resetDb(db: TestDB) {
  await db.execute(sql`truncate table
    tracking.shipment_pos, tracking.shipment_milestones, tracking.shipments,
    tracking.booking_pos, tracking.bookings, tracking.purchase_orders,
    tracking.field_locks, tracking.forwarder_aliases, tracking.consignees,
    tracking.forwarders, tracking.vendors, tracking.customers, tracking.ports,
    audit.change_log, evidence.parsed_record, queue.queue_message,
    alerts.alerts, alerts.alert_rules
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
    shipment: new ShipmentRepository(db),
    fieldLock: new FieldLockRepository(db),
    audit: new AuditRepository(db),
    alert: new AlertRepository(db),
    evidence: new EvidenceRepository(db),
  }
}
