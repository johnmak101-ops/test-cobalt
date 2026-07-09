import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql, type Kysely } from 'kysely'
import { createKysely } from '../src/db/kysely/mssql-dialect'
import { runMigrations } from '../src/db/kysely/migrate'
import { join } from 'node:path'

const URL =
  process.env.SQL_SERVER_TEST_URL ??
  'Server=localhost,1433;Database=cobalt_test;User Id=sa;Password=YourStrong!Passw0rd;Encrypt=false;TrustServerCertificate=true'

const RUN = process.env.FABRIC_FOUNDATION === '1'

let db: Kysely<unknown>

beforeAll(async () => {
  if (!RUN) return
  db = createKysely<unknown>(URL)
  // reset: drop all tables in dbo that belong to our schema, then the migration ledger.
  // SQL Server has no CASCADE — drop FKs first, then tables.
  await sql`
DECLARE @sql NVARCHAR(MAX) = N''
SELECT @sql = @sql + N'ALTER TABLE ' + QUOTENAME(schema_name(t.schema_id)) + N'.' + QUOTENAME(t.name) + N' DROP CONSTRAINT ' + QUOTENAME(fk.name) + N';'
FROM sys.foreign_keys fk
JOIN sys.tables t ON fk.parent_object_id = t.object_id
WHERE schema_name(t.schema_id) = 'dbo'
EXEC sp_executesql @sql`.execute(db).catch(() => {})
  await sql`
DECLARE @sql NVARCHAR(MAX) = N''
SELECT @sql = @sql + N'DROP TABLE ' + QUOTENAME(schema_name(t.schema_id)) + N'.' + QUOTENAME(t.name) + N';'
FROM sys.tables t
WHERE schema_name(t.schema_id) = 'dbo'
EXEC sp_executesql @sql`.execute(db).catch(() => {})
  await sql`DROP TABLE IF EXISTS kysely_migration`.execute(db).catch(() => {})
  await sql`DROP TABLE IF EXISTS kysely_migration_lock`.execute(db).catch(() => {})
  await runMigrations(db, join(process.cwd(), 'kysely-migrations'))
})
afterAll(async () => {
  if (!RUN) return
  await db.destroy()
})

// The 29 tables the foundation migration must create (all in the default dbo schema).
const EXPECTED: Record<string, string[]> = {
  tracking: [
    'users', 'refresh_tokens', 'customers', 'vendors', 'forwarders', 'forwarder_aliases',
    'consignees', 'ports', 'master_resolution', 'purchase_orders', 'bookings', 'booking_pos',
    'shipments', 'shipment_pos', 'shipment_identifiers', 'shipment_parties', 'shipment_milestones',
    'shipment_emails', 'app_settings', 'field_locks', 'review_email', 'email_read',
  ],
  ingest: ['email_message', 'email_attachment', 'parsed_record', 'ingest_state'],
  alerts: ['alert_rules', 'alerts'],
  audit: ['change_log'],
}

// flatten into one list for the dbo check
const ALL_TABLES = Object.values(EXPECTED).flat()

describe.runIf(RUN)('Foundation — 0000_init creates all 29 tables', () => {
  for (const table of ALL_TABLES) {
    it(`creates dbo.${table}`, async () => {
      const result = await sql`SELECT CASE WHEN OBJECT_ID(${sql.lit(table)}) IS NOT NULL THEN 1 ELSE 0 END AS cnt`
        .execute(db)
      expect(Number(result.rows[0]?.cnt)).toBe(1)
    })
  }

  it('creates all 29 tables (count check)', async () => {
    const result = await sql`
      SELECT count(*) AS cnt FROM sys.tables t
      JOIN sys.schemas s ON t.schema_id = s.schema_id
      WHERE s.name = 'dbo' AND t.name IN (${sql.join(ALL_TABLES.map((t) => sql.lit(t)), sql.raw(','))})`.execute(db)
    expect(Number(result.rows[0]?.cnt)).toBe(29)
  })
})
