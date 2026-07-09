import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'kysely'
import { createKysely } from '../src/db/kysely/mssql-dialect'
import { runMigrations } from '../src/db/kysely/migrate'
import { KyselyBookingRepository } from '../src/db/repositories/booking.repository.kysely'
import { JOB_NO_PREFIX } from '../src/common/job-no'
import { join } from 'node:path'
import type { Kysely } from 'kysely'
import type { DB } from '../src/db/kysely/db.generated'

const URL =
  process.env.SQL_SERVER_TEST_URL ??
  'Server=localhost,1433;Database=cobalt_test;User Id=sa;Password=YourStrong!Passw0rd;Encrypt=false;TrustServerCertificate=true'
const RUN = process.env.FABRIC_FOUNDATION === '1'

let db: Kysely<DB>
let repo: KyselyBookingRepository

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
  repo = new KyselyBookingRepository(db)
})
afterAll(async () => {
  if (!RUN) return
  await db.destroy()
})

async function seedPo(poNumber = `PO-${Math.random()}`) {
  return (await db.insertInto('purchaseOrders').values({ poNumber }).output('inserted.id').executeTakeFirstOrThrow()).id
}

describe.runIf(RUN)('KyselyBookingRepository (SQL Server)', () => {
  it('create + findById + listOrdered (newest-created first)', async () => {
    const a = await repo.create({ jobNo: `${JOB_NO_PREFIX}0001` })
    await sleep(10)
    const b = await repo.create({ jobNo: `${JOB_NO_PREFIX}0002` })
    expect(await repo.findById(a.id)).toBeTruthy()
    expect((await repo.findById('00000000-0000-0000-0000-000000000000'))).toBeNull()
    const rows = await repo.listOrdered()
    // newest first
    expect(rows[0].id).toBe(b.id)
  })

  it('update patches fields + bumps updatedAt', async () => {
    const b = await repo.create({ jobNo: `${JOB_NO_PREFIX}0010`, brand: 'OLD' })
    const row = await repo.update(b.id, { brand: 'NEW', notes: 'n' })
    expect(row?.brand).toBe('NEW')
    expect(row?.notes).toBe('n')
    expect((await repo.findById(b.id))?.brand).toBe('NEW')
  })

  it('count returns the row total', async () => {
    const before = await repo.count()
    await repo.create({ jobNo: `${JOB_NO_PREFIX}0020` })
    expect(await repo.count()).toBe(before + 1)
  })

  it('nextJobSeq = MAX(trailing number) + 1, scoped to the JOB- family', async () => {
    // seed a high-water mark within the family
    await repo.create({ jobNo: `${JOB_NO_PREFIX}0099` })
    await repo.create({ jobNo: `${JOB_NO_PREFIX}0105` })
    // a foreign-format booking must NOT perturb the sequence
    await db.insertInto('bookings').values({ jobNo: 'LEGACY-9999' }).execute()
    const seq = await repo.nextJobSeq()
    expect(seq).toBe(106)
  })

  it('nextJobSeq starts at 1 when no JOB- bookings exist', async () => {
    // clear the family for this assertion (foreign rows remain but are out of scope)
    await db.deleteFrom('bookings').where('jobNo', 'like', `${JOB_NO_PREFIX}%`).execute()
    expect(await repo.nextJobSeq()).toBe(1)
  })

  it('linkPo is idempotent; posFor + poNumbersFor read the links', async () => {
    const bId = (await repo.create({ jobNo: `${JOB_NO_PREFIX}0030` })).id
    const po1 = await seedPo('PO-BK1')
    const po2 = await seedPo('PO-BK2')
    await repo.linkPo(bId, po1)
    await repo.linkPo(bId, po2)
    await repo.linkPo(bId, po1) // duplicate → no-op, no throw
    const pos = await repo.posFor(bId)
    expect(pos.map((p) => p.poNumber).sort()).toEqual(['PO-BK1', 'PO-BK2'])
    expect((await repo.poNumbersFor(bId)).sort()).toEqual(['PO-BK1', 'PO-BK2'])
  })

  it('posFor / poNumbersFor return empty for a booking with no PO links', async () => {
    const bId = (await repo.create({ jobNo: `${JOB_NO_PREFIX}0040` })).id
    expect(await repo.posFor(bId)).toEqual([])
    expect(await repo.poNumbersFor(bId)).toEqual([])
  })

  it('findByIds + poNumbersByBooking batch reads (one query each)', async () => {
    const b1 = (await repo.create({ jobNo: `${JOB_NO_PREFIX}0050` })).id
    const b2 = (await repo.create({ jobNo: `${JOB_NO_PREFIX}0051` })).id
    const b3 = (await repo.create({ jobNo: `${JOB_NO_PREFIX}0052` })).id // no POs
    const po1 = await seedPo('PO-BB1')
    const po2 = await seedPo('PO-BB2')
    await repo.linkPo(b1, po1)
    await repo.linkPo(b2, po2)
    await repo.linkPo(b2, po1)

    const byId = await repo.findByIds([b1, b2, b3])
    expect(byId.size).toBe(3)
    expect(byId.get(b1)?.jobNo).toBe(`${JOB_NO_PREFIX}0050`)
    expect(byId.get('00000000-0000-0000-0000-000000000000')).toBeUndefined()
    // empty input → empty map, no query
    expect((await repo.findByIds([])).size).toBe(0)

    const byBooking = await repo.poNumbersByBooking([b1, b2, b3])
    expect(byBooking.size).toBe(2) // b3 has no POs → absent
    expect(byBooking.get(b1)?.sort()).toEqual(['PO-BB1'])
    expect(byBooking.get(b2)?.sort()).toEqual(['PO-BB1', 'PO-BB2'])
    expect(byBooking.get(b3)).toBeUndefined()
    // empty input → empty map, no query
    expect((await repo.poNumbersByBooking([])).size).toBe(0)
  })
})

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
