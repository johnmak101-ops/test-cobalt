import { Kysely, sql } from 'kysely'
import { join } from 'node:path'
import { createKysely, parseMssqlConnectionString } from '../src/db/kysely/mssql-dialect'
import { runMigrations } from '../src/db/kysely/migrate'
import type { DB } from '../src/db/kysely/db'
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
import { RoutingShadowRepository } from '../src/db/repositories/routing-shadow.repository'

const TEST_URL =
  process.env.SQL_SERVER_TEST_URL ??
  'Server=localhost,1433;Database=cobalt_test;User Id=sa;Password=YourStrong!Passw0rd;Encrypt=false;TrustServerCertificate=true'

export type TestDB = Kysely<DB>

let db: TestDB | null = null

/** Lazily create + migrate the dedicated `cobalt_test` SQL Server database (separate from dev data).
 *  Kysely's own `kysely_migration` ledger makes migrations incremental — a newly-added migration
 *  auto-applies on the next run, no manual DROP DATABASE needed. */
export async function getTestDb(): Promise<{ db: TestDB }> {
  if (db) return { db }
  const dbName = parseMssqlConnectionString(TEST_URL).database
  const master = createKysely<unknown>(TEST_URL.replace(/Database=[^;]+/i, 'Database=master'))
  await sql.raw(`IF DB_ID('${dbName}') IS NULL CREATE DATABASE [${dbName}]`).execute(master)
  await master.destroy()
  const handle = createKysely<DB>(TEST_URL)
  await runMigrations(handle, join(process.cwd(), 'src/db/kysely-migrations'))
  db = handle
  return { db }
}

/** Wipe every row (all tables, FK-safe via NOCHECK, identity reseeded) except the migration ledger —
 *  the SQL Server analogue of the old `truncate … restart identity cascade`. */
export async function resetDb(db: TestDB) {
  await sql.raw(`EXEC sp_MSforeachtable 'ALTER TABLE ? NOCHECK CONSTRAINT ALL'`).execute(db)
  await sql
    .raw(
      `EXEC sp_MSforeachtable @command1='IF OBJECT_NAME(object_id(''?'')) NOT IN (''kysely_migration'',''kysely_migration_lock'') DELETE FROM ?'`,
    )
    .execute(db)
  await sql.raw(`EXEC sp_MSforeachtable 'ALTER TABLE ? WITH CHECK CHECK CONSTRAINT ALL'`).execute(db)
  await sql
    .raw(
      `EXEC sp_MSforeachtable 'IF OBJECTPROPERTY(object_id(''?''), ''TableHasIdentity'') = 1 DBCC CHECKIDENT (''?'', RESEED, 0)'`,
    )
    .execute(db)
}

export async function closeTestDb() {
  if (db) {
    await db.destroy()
    db = null
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
    routingShadow: new RoutingShadowRepository(db),
  }
}
