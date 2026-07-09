import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'

let db: TestDB
let bookings: ReturnType<typeof repos>['booking']

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  bookings = repos(db).booking
})
afterAll(closeTestDb)
beforeEach(() => resetDb(db))

describe('BookingRepository.posFor (integration)', () => {
  it('returns every full PO row linked to the booking — and only that booking’s', async () => {
    const bk = await db.insertInto('bookings').values({ jobNo: 'JOB-PF' }).outputAll('inserted').executeTakeFirstOrThrow()
    const other = await db.insertInto('bookings').values({ jobNo: 'JOB-OTHER' }).outputAll('inserted').executeTakeFirstOrThrow()
    const p1 = await db.insertInto('purchaseOrders').values({ poNumber: 'PO-1' }).outputAll('inserted').executeTakeFirstOrThrow()
    const p2 = await db.insertInto('purchaseOrders').values({ poNumber: 'PO-2' }).outputAll('inserted').executeTakeFirstOrThrow()
    const p3 = await db.insertInto('purchaseOrders').values({ poNumber: 'PO-3' }).outputAll('inserted').executeTakeFirstOrThrow()
    await db.insertInto('bookingPos').values([
      { bookingId: bk.id, poId: p1.id },
      { bookingId: bk.id, poId: p2.id },
      { bookingId: other.id, poId: p3.id }, // different booking → must NOT appear
    ]).execute()

    const pos = await bookings.posFor(bk.id)
    expect(pos.map((p) => p.poNumber).sort()).toEqual(['PO-1', 'PO-2'])
    // full PO rows (id + poNumber present), not just numbers
    expect(pos.every((p) => typeof p.id === 'string' && typeof p.poNumber === 'string')).toBe(true)
  })

  it('returns [] for a booking with no linked POs', async () => {
    const bk = await db.insertInto('bookings').values({ jobNo: 'JOB-EMPTY' }).outputAll('inserted').executeTakeFirstOrThrow()
    expect(await bookings.posFor(bk.id)).toEqual([])
  })
})
