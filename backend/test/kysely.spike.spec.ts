import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { sql, type Kysely } from 'kysely'
import { createKysely } from '../src/db/kysely/mssql-dialect'
import { runMigrations } from '../src/db/kysely/migrate'
import { join } from 'node:path'

const URL =
  process.env.KYSELY_TEST_URL ??
  'Server=localhost,1433;Database=cobalt_test;User Id=sa;Password=YourStrong!Passw0rd;Encrypt=false;TrustServerCertificate=true'

interface SpikeDB {
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

let db: Kysely<SpikeDB>

beforeAll(async () => {
  db = createKysely<SpikeDB>(URL)
  // reset deterministically: drop the spike tables (FK order) + Kysely's migration ledger so migrations
  // re-run clean. SQL Server has no DROP TABLE CASCADE; drop children first.
  await sql`DROP TABLE IF EXISTS shipments`.execute(db)
  await sql`DROP TABLE IF EXISTS bookings`.execute(db)
  await sql`DROP TABLE IF EXISTS customers`.execute(db)
  await sql`DROP TABLE IF EXISTS kysely_migration`.execute(db)
  await sql`DROP TABLE IF EXISTS kysely_migration_lock`.execute(db)
  await runMigrations(db, join(process.cwd(), 'kysely-migrations'))
})
afterAll(async () => {
  await db.destroy()
})

describe('Kysely MSSQL spike', () => {
  it('inserts a customer + booking + shipment with uuid PKs, a FK, a CHECK enum, and a json column', async () => {
    const customer = await db
      .insertInto('customers')
      .values({ code: 'SPIKE', name: 'Spike Co', country: 'Hong Kong', contactEmail: 'ops@spike.com', address: 'KT' })
      .output('inserted.id')
      .executeTakeFirstOrThrow()

    const booking = await db
      .insertInto('bookings')
      .values({ jobNo: 'JOB-1', customerId: customer.id, brand: 'BRAND', status: 'ACTIVE', notes: 'a note' })
      .output('inserted.id')
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
      .output(['inserted.id', 'inserted.matchKeys'])
      .executeTakeFirstOrThrow()

    // json column round-trips as an object (ParseJSONResultsPlugin parses the NVARCHAR(MAX))
    expect(shipment.matchKeys).toEqual({ hbl_awb_fcr_no: 'HBL001' })

    const readBack = await db
      .selectFrom('bookings')
      .select(['jobNo', 'customerId', 'status'])
      .where('id', '=', booking.id)
      .executeTakeFirstOrThrow()
    expect(readBack).toMatchObject({ jobNo: 'JOB-1', customerId: customer.id, status: 'ACTIVE' })
  })

  it('runs a window-function query (ROW_NUMBER OVER PARTITION BY)', async () => {
    const c = await db.insertInto('customers').values({ code: 'WIN', name: 'Window Co' }).output('inserted.id').executeTakeFirstOrThrow()
    const b1 = await db.insertInto('bookings').values({ jobNo: 'W-1', customerId: c.id }).output('inserted.id').executeTakeFirstOrThrow()
    const b2 = await db.insertInto('bookings').values({ jobNo: 'W-2', customerId: c.id }).output('inserted.id').executeTakeFirstOrThrow()
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
        sql<number>`CAST(ROW_NUMBER() OVER (PARTITION BY ${sql.ref('bookingId')} ORDER BY ${sql.ref('legNo')}) AS int)`.as('rn'),
      ])
      .orderBy('bookingId')
      .orderBy('legNo')
      .execute()

    const b1Rows = rows.filter((r) => r.bookingId === b1.id)
    expect(b1Rows.map((r) => r.rn)).toEqual([1, 2])
    const b2Rows = rows.filter((r) => r.bookingId === b2.id)
    expect(b2Rows.map((r) => r.rn)).toEqual([1])
  })

  it('runs a transaction (all-or-nothing on a CHECK violation)', async () => {
    const before = await db.selectFrom('customers').select(sql`count(*)`.as('n')).executeTakeFirstOrThrow()

    await expect(
      db.transaction().execute(async (tx) => {
        await tx.insertInto('customers').values({ code: 'TX-OK', name: 'Tx Ok' }).execute()
        // a CHECK violation inside the tx rolls the whole thing back
        await tx.insertInto('bookings').values({ jobNo: 'TX-BAD', status: 'NOPE' }).execute()
      }),
    ).rejects.toThrow()

    const after = await db.selectFrom('customers').select(sql`count(*)`.as('n')).executeTakeFirstOrThrow()
    expect(Number(after.n)).toBe(Number(before.n)) // the TX-OK insert was rolled back
  })
})
