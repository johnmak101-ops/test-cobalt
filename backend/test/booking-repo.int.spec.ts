import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import * as schema from '../src/db/contracts'
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
    const [bk] = await db.insert(schema.bookings).values({ jobNo: 'JOB-PF' }).returning()
    const [other] = await db.insert(schema.bookings).values({ jobNo: 'JOB-OTHER' }).returning()
    const [p1] = await db.insert(schema.purchaseOrders).values({ poNumber: 'PO-1' }).returning()
    const [p2] = await db.insert(schema.purchaseOrders).values({ poNumber: 'PO-2' }).returning()
    const [p3] = await db.insert(schema.purchaseOrders).values({ poNumber: 'PO-3' }).returning()
    await db.insert(schema.bookingPos).values([
      { bookingId: bk.id, poId: p1.id },
      { bookingId: bk.id, poId: p2.id },
      { bookingId: other.id, poId: p3.id }, // different booking → must NOT appear
    ])

    const pos = await bookings.posFor(bk.id)
    expect(pos.map((p) => p.poNumber).sort()).toEqual(['PO-1', 'PO-2'])
    // full PO rows (id + poNumber present), not just numbers
    expect(pos.every((p) => typeof p.id === 'string' && typeof p.poNumber === 'string')).toBe(true)
  })

  it('returns [] for a booking with no linked POs', async () => {
    const [bk] = await db.insert(schema.bookings).values({ jobNo: 'JOB-EMPTY' }).returning()
    expect(await bookings.posFor(bk.id)).toEqual([])
  })
})
