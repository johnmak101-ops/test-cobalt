import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import * as schema from '../src/db/contracts'
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
  pos = new PosService(r.purchaseOrder)
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

  it('gives each candidate ONLY its own booking’s POs (no cross-leg bleed when batching the PO lookup)', async () => {
    // Two legs share a strong key but sit on SEPARATE bookings, each with its own PO. Each candidate must
    // carry only that booking's PO — pins the per-booking grouping the bulk poNumbersByBooking load relies on.
    await seedLeg({ so_no: 'SO-DUP' }, { jobNo: 'JOB-D-1', po: 'PO-AAA' })
    await seedLeg({ so_no: 'SO-DUP' }, { jobNo: 'JOB-D-2', po: 'PO-BBB' })
    const res = await shipments.lookupByMatchKey({ so_no: 'SO-DUP' })
    expect(res.candidates).toHaveLength(2)
    const posByJob = Object.fromEntries((res.candidates as any[]).map((c) => [c.jobNo, c.pos]))
    expect(posByJob['JOB-D-1']).toEqual(['PO-AAA'])
    expect(posByJob['JOB-D-2']).toEqual(['PO-BBB'])
  })

  it('surfaces human-locked fields so the agent does not propose to overwrite them', async () => {
    const { leg } = await seedLeg({ so_no: 'SO-3' }, { jobNo: 'JOB-B-3' })
    await db
      .insert(schema.fieldLocks)
      .values({ entityType: 'shipment', entityId: leg.id, field: 'eta', lockedValue: '2026-05-01' })
    const res = await shipments.lookupByMatchKey({ so_no: 'SO-3' })
    expect((res.candidates[0] as any).lockedFields).toContain('eta')
  })

  // Contract with the Agent VM (cobalt-queue `matcher/backend-adapter.ts`): a candidate must carry the
  // transport `mode` as a TOP-LEVEL column, the identity columns in camelCase (soNo, hblAwbFcrNo, …), and the
  // snake_case `matchKeys` bag. The adapter camel→snake-cases the columns into `fields`, lifts `mode` for the
  // gate's sea↔air check, and passes `matchKeys` through as the strong-key bag. If this projection ever
  // narrows (e.g. `allLegs()`/`lookupByMatchKey` start selecting a subset that drops `mode` or `matchKeys`),
  // the agent's `backendDiff` silently goes inert — every update forced to review, or unsafe auto-applies —
  // with no other failing test. This pins the wire shape the adapter depends on.
  it('returns candidates in the shape the Agent VM adapter consumes (mode + camelCase columns + matchKeys)', async () => {
    const [bk] = await db.insert(schema.bookings).values({ jobNo: 'JOB-CT', status: 'ACTIVE' }).returning()
    await db.insert(schema.shipments).values({
      bookingId: bk.id,
      legNo: 1,
      mode: 'AIR', // uppercase SHIPMENT_MODE enum — must arrive verbatim, NOT lowercased
      soNo: 'SO-CT',
      hblAwbFcrNo: 'HAWB-CT',
      matchKeys: { so_no: 'SO-CT' },
    })
    const res = await shipments.lookupByMatchKey({ so_no: 'SO-CT' })
    const c = res.candidates[0] as any
    expect(c).toBeTruthy()
    expect(c.mode).toBe('AIR') // top-level transport mode (gate's sea↔air check reads it)
    expect(c.soNo).toBe('SO-CT') // camelCase identity columns → adapter camel→snakes them into `fields`
    expect(c.hblAwbFcrNo).toBe('HAWB-CT')
    expect(c.matchKeys).toMatchObject({ so_no: 'SO-CT' }) // snake_case bag → adapter passes through as matchKey
  })

  it('lists active legs as tracker rows with their linked POs', async () => {
    await seedLeg({ so_no: 'SO-T1' }, { jobNo: 'JOB-T-9', po: 'PO-T9' })
    const res = await shipments.listForTracker()
    const row = res.shipments.find((s) => s.linkedPOs.some((p) => p.poNumber === 'PO-T9'))
    expect(row).toBeTruthy()
    expect(row!.status).toBe('BOOKED')
    expect(row!.linkedPOs[0]!.poNumber).toBe('PO-T9')
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
