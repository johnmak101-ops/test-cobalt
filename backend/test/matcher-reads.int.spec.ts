import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import * as schema from '@cobalt/contracts'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import { ShipmentsService } from '../src/shipments/shipments.service'
import { PosService } from '../src/pos/pos.service'

let db: TestDB
let shipments: ShipmentsService
let pos: PosService

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  const r = repos(db)
  shipments = new ShipmentsService(r.shipment, r.booking, r.fieldLock)
  pos = new PosService(r.booking)
})
afterAll(closeTestDb)
beforeEach(() => resetDb(db))

async function seedLeg(
  matchKeys: Record<string, unknown>,
  opts: { jobNo?: string; status?: 'ACTIVE' | 'CLOSED' | 'CANCELLED'; po?: string } = {},
) {
  const [bk] = await db
    .insert(schema.bookings)
    .values({ jobNo: opts.jobNo ?? 'JOB-B-1', status: opts.status ?? 'ACTIVE' })
    .returning()
  const [leg] = await db.insert(schema.shipments).values({ bookingId: bk.id, legNo: 1, matchKeys }).returning()
  if (opts.po) {
    const [po] = await db.insert(schema.purchaseOrders).values({ poNumber: opts.po }).returning()
    await db.insert(schema.bookingPos).values({ bookingId: bk.id, poId: po.id })
  }
  return { bk, leg }
}

describe('Matcher read-APIs (integration)', () => {
  it('finds a candidate leg by a shared strong key', async () => {
    await seedLeg({ so_no: 'SO-1', booking_no: 'BK-1' }, { jobNo: 'JOB-B-1', po: 'PO-1' })
    const res = await shipments.lookupByMatchKey({ so_no: 'SO-1' })
    expect(res.candidates).toHaveLength(1)
    const c = res.candidates[0] as any
    expect(c.jobNo).toBe('JOB-B-1')
    expect(c.pos).toContain('PO-1')
    expect(c.matchedBy).toBe('strong_key')
  })

  it('returns no candidates for an unknown key', async () => {
    await seedLeg({ so_no: 'SO-1' })
    const res = await shipments.lookupByMatchKey({ so_no: 'NOPE' })
    expect(res.candidates).toHaveLength(0)
  })

  it('also matches on a shared PO (rotating-id resilience)', async () => {
    await seedLeg({ so_no: 'SO-2' }, { jobNo: 'JOB-B-2', po: 'PO-2' })
    const res = await shipments.lookupByMatchKey({ customer_po: 'PO-2' })
    expect(res.candidates).toHaveLength(1)
    expect((res.candidates[0] as any).matchedBy).toBe('po')
  })

  it('surfaces human-locked fields so the agent does not propose to overwrite them', async () => {
    const { leg } = await seedLeg({ so_no: 'SO-3' }, { jobNo: 'JOB-B-3' })
    await db
      .insert(schema.fieldLocks)
      .values({ entityType: 'shipment', entityId: leg.id, field: 'eta', lockedValue: '2026-05-01' })
    const res = await shipments.lookupByMatchKey({ so_no: 'SO-3' })
    expect((res.candidates[0] as any).lockedFields).toContain('eta')
  })

  it('lists the PO master with customer/vendor codes resolved', async () => {
    const [cust] = await db.insert(schema.customers).values({ code: 'WYSE', name: 'Wyse London' }).returning()
    await db.insert(schema.purchaseOrders).values({ poNumber: 'PO-OPEN', customerId: cust.id })
    const list = (await pos.list()) as any[]
    expect(list.find((p) => p.poNumber === 'PO-OPEN')?.customerCode).toBe('WYSE')
  })

  it('open=true excludes POs whose bookings are terminal (CLOSED/CANCELLED)', async () => {
    const [poClosed] = await db.insert(schema.purchaseOrders).values({ poNumber: 'PO-CLOSED' }).returning()
    const [bkClosed] = await db.insert(schema.bookings).values({ jobNo: 'JOB-CL', status: 'CLOSED' }).returning()
    await db.insert(schema.bookingPos).values({ bookingId: bkClosed.id, poId: poClosed.id })
    await db.insert(schema.purchaseOrders).values({ poNumber: 'PO-ACTIVE' })

    const all = ((await pos.list(false)) as any[]).map((p) => p.poNumber)
    const open = ((await pos.list(true)) as any[]).map((p) => p.poNumber)
    expect(all).toEqual(expect.arrayContaining(['PO-CLOSED', 'PO-ACTIVE']))
    expect(open).toContain('PO-ACTIVE')
    expect(open).not.toContain('PO-CLOSED')
  })
})
