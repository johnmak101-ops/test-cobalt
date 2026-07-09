import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'kysely'
import { createKysely } from '../src/db/kysely/mssql-dialect'
import { runMigrations } from '../src/db/kysely/migrate'
import { KyselyFieldLockRepository } from '../src/db/repositories/field-lock.repository.kysely'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Kysely } from 'kysely'
import type { DB } from '../src/db/kysely/db.generated'

const URL =
  process.env.SQL_SERVER_TEST_URL ??
  'Server=localhost,1433;Database=cobalt_test;User Id=sa;Password=YourStrong!Passw0rd;Encrypt=false;TrustServerCertificate=true'
const RUN = process.env.FABRIC_FOUNDATION === '1'

let db: Kysely<DB>
let repo: KyselyFieldLockRepository

beforeAll(async () => {
  if (!RUN) return
  db = createKysely<DB>(URL)
  await sql`
DECLARE @sql NVARCHAR(MAX) = N''
SELECT @sql = @sql + N'ALTER TABLE ' + QUOTENAME(schema_name(t.schema_id)) + N'.' + QUOTENAME(t.name) + N' DROP CONSTRAINT ' + QUOTENAME(fk.name) + N';'
FROM sys.foreign_keys fk JOIN sys.tables t ON fk.parent_object_id = t.object_id WHERE schema_name(t.schema_id) = 'dbo'
EXEC sp_executesql @sql`.execute(db).catch(() => {})
  await sql`
DECLARE @sql NVARCHAR(MAX) = N''
SELECT @sql = @sql + N'DROP TABLE ' + QUOTENAME(schema_name(t.schema_id)) + N'.' + QUOTENAME(t.name) + N';'
FROM sys.tables t WHERE schema_name(t.schema_id) = 'dbo'
EXEC sp_executesql @sql`.execute(db).catch(() => {})
  await sql`DROP TABLE IF EXISTS kysely_migration`.execute(db).catch(() => {})
  await sql`DROP TABLE IF EXISTS kysely_migration_lock`.execute(db).catch(() => {})
  await runMigrations(db, join(process.cwd(), 'kysely-migrations'))
  repo = new KyselyFieldLockRepository(db)
})
afterAll(async () => {
  if (!RUN) return
  await db.destroy()
})

async function seedUser(email = 'u@x.co') {
  return (await db.insertInto('users').values({ email, name: 'U', passwordHash: 'x' }).output('inserted.id').executeTakeFirstOrThrow()).id
}

describe.runIf(RUN)('KyselyFieldLockRepository (SQL Server)', () => {
  it('lock inserts a new field lock (booking + shipment)', async () => {
    const userId = await seedUser('l1@x.co')
    const bookingId = randomUUID()
    const bookingRow = await repo.lock('booking', bookingId, 'brand', 'ACME', userId)
    expect(bookingRow).toMatchObject({ entityType: 'booking', field: 'brand', lockedValue: 'ACME', lockedBy: userId })
    expect(bookingRow?.entityId.toLowerCase()).toBe(bookingId) // SQL Server returns UUIDs uppercase
    const shipmentRow = await repo.lock('shipment', randomUUID(), 'pol_raw', 'HK', userId)
    expect(shipmentRow?.entityType).toBe('shipment')
  })

  it('lock is idempotent: a second lock on the same entity+field UPDATES the value (not a duplicate)', async () => {
    const userId = await seedUser('l2@x.co')
    const entityId = randomUUID()
    const first = await repo.lock('shipment', entityId, 'booking_no', 'OLD', userId)
    const second = await repo.lock('shipment', entityId, 'booking_no', 'NEW', userId)
    expect(second?.id).toBe(first?.id) // same row
    expect(second?.lockedValue).toBe('NEW')
    // only one lock row for that entity+field
    const locks = await repo.forEntity(entityId)
    expect(locks.filter((l) => l.field === 'booking_no').length).toBe(1)
  })

  it('lock accepts a null value + null userId (clearing a lock value)', async () => {
    const entityId = randomUUID()
    await repo.lock('shipment', entityId, 'notes', 'x', null)
    const row = await repo.lock('shipment', entityId, 'notes', null, null)
    expect(row?.lockedValue).toBeNull()
    expect(row?.lockedBy).toBeNull()
  })

  it('forEntity returns all locks for an entity, across fields', async () => {
    const userId = await seedUser('l4@x.co')
    const entityId = randomUUID()
    await repo.lock('shipment', entityId, 'booking_no', 'B1', userId)
    await repo.lock('shipment', entityId, 'so_no', 'SO1', userId)
    await repo.lock('shipment', entityId, 'container_no', 'CNT1', userId)
    const locks = await repo.forEntity(entityId)
    expect(locks.map((l) => l.field).sort()).toEqual(['booking_no', 'container_no', 'so_no'])
  })

  it("forEntity is scoped — does not leak another entity's locks", async () => {
    const aId = randomUUID()
    const bId = randomUUID()
    await repo.lock('shipment', aId, 'booking_no', 'A', null)
    await repo.lock('shipment', bId, 'booking_no', 'B', null)
    const a = await repo.forEntity(aId)
    expect(a.length).toBe(1)
    expect(a[0].lockedValue).toBe('A')
  })
})
