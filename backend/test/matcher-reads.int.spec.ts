import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import { ShipmentsService } from '../src/shipments/shipments.service'
import { PosService } from '../src/pos/pos.service'
import { CommitterService } from '../src/reconcile/committer.service'
import { matchKeyIndexRows } from '../src/reconcile/match-key-index'
import { normKey } from '../src/reconcile/match-keys'

let db: TestDB
let shipments: ShipmentsService
let pos: PosService
let committer: CommitterService

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  const r = repos(db)
  committer = new CommitterService(r.masters, r.booking, r.shipment, r.fieldLock, r.audit, r.evidence, r.purchaseOrder, r.settings)
  const queueLearning = { postCorrection: async () => undefined } as never
  shipments = new ShipmentsService(r.shipment, r.booking, r.fieldLock, r.audit, committer, queueLearning, r.masters, r.priorCorrections)
  pos = new PosService(r.purchaseOrder)
})
afterAll(closeTestDb)
beforeEach(() => resetDb(db))

/**
 * Production-shaped seed: match_keys JSON on the leg PLUS the queryable indexes the candidate path
 * needs (shipment_match_keys from strongKeys, purchase_orders.po_number_norm). Mirrors committer.writeMatchKeyIndex
 * + PO write. Without the indexes, lookupByMatchKey (Increment 3) cannot find the leg.
 */
async function seedLeg(
  matchKeys: Record<string, unknown>,
  opts: { jobNo?: string; status?: 'ACTIVE' | 'CLOSED' | 'CANCELLED'; po?: string } = {},
) {
  const bk = await db
    .insertInto('bookings')
    .values({ jobNo: opts.jobNo ?? 'JOB-B-1', status: opts.status ?? 'ACTIVE' })
    .outputAll('inserted')
    .executeTakeFirstOrThrow()
  const leg = await db
    .insertInto('shipments')
    .values({ bookingId: bk.id, legNo: 1, matchKeys: JSON.stringify(matchKeys) })
    .outputAll('inserted')
    .executeTakeFirstOrThrow()
  const indexRows = matchKeyIndexRows(leg.id, matchKeys)
  if (indexRows.length) await db.insertInto('shipmentMatchKeys').values(indexRows as never).execute()
  if (opts.po) {
    const po = await db
      .insertInto('purchaseOrders')
      .values({ poNumber: opts.po, poNumberNorm: normKey(opts.po) })
      .outputAll('inserted')
      .executeTakeFirstOrThrow()
    await db.insertInto('bookingPos').values({ bookingId: bk.id, poId: po.id }).execute()
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
      .insertInto('fieldLocks')
      .values({ entityType: 'shipment', entityId: leg.id, field: 'eta', lockedValue: '2026-05-01' })
      .execute()
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
    const bk = await db.insertInto('bookings').values({ jobNo: 'JOB-CT', status: 'ACTIVE' }).outputAll('inserted').executeTakeFirstOrThrow()
    const leg = await db.insertInto('shipments').values({
      bookingId: bk.id,
      legNo: 1,
      mode: 'AIR', // uppercase SHIPMENT_MODE enum — must arrive verbatim, NOT lowercased
      soNo: 'SO-CT',
      hblAwbFcrNo: 'HAWB-CT',
      matchKeys: JSON.stringify({ so_no: 'SO-CT' }),
    }).outputAll('inserted').executeTakeFirstOrThrow()
    await db.insertInto('shipmentMatchKeys').values(matchKeyIndexRows(leg.id, { so_no: 'SO-CT' }) as never).execute()
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
    const cust = await db.insertInto('customers').values({ code: 'WYSE', name: 'Wyse London' }).outputAll('inserted').executeTakeFirstOrThrow()
    await db.insertInto('purchaseOrders').values({ poNumber: 'PO-OPEN', customerId: cust.id }).execute()
    const list = (await pos.list()) as any[]
    expect(list.find((p) => p.poNumber === 'PO-OPEN')?.customerCode).toBe('WYSE')
  })

  it('open=true excludes POs whose bookings are terminal (CLOSED/CANCELLED)', async () => {
    const poClosed = await db.insertInto('purchaseOrders').values({ poNumber: 'PO-CLOSED' }).outputAll('inserted').executeTakeFirstOrThrow()
    const bkClosed = await db.insertInto('bookings').values({ jobNo: 'JOB-CL', status: 'CLOSED' }).outputAll('inserted').executeTakeFirstOrThrow()
    await db.insertInto('bookingPos').values({ bookingId: bkClosed.id, poId: poClosed.id }).execute()
    await db.insertInto('purchaseOrders').values({ poNumber: 'PO-ACTIVE' }).execute()

    const all = ((await pos.list(false)) as any[]).map((p) => p.poNumber)
    const open = ((await pos.list(true)) as any[]).map((p) => p.poNumber)
    expect(all).toEqual(expect.arrayContaining(['PO-CLOSED', 'PO-ACTIVE']))
    expect(open).toContain('PO-ACTIVE')
    expect(open).not.toContain('PO-CLOSED')
  })
})

/**
 * INCREMENT 3 — matcher read-API drops the allLegs() full-scan and uses the same indexed candidate
 * superset as committer.apply (shipment_match_keys ∪ po_number_norm). Behavior of the pure
 * strong-key / shared-PO filter is unchanged; only the candidate SET is narrowed at the DB.
 */
describe('ShipmentsService.lookupByMatchKey — candidate-query swap (Increment 3)', () => {
  it('finds a committer-written leg by strong key (index path, not matchKeys JSON alone)', async () => {
    const a = await committer.apply({
      fields: { booking_no: 'BK-LK' },
      pos: [],
      matchKeys: { booking_no: 'BK-LK' },
      emailTypes: ['Booking Request'],
      events: [{ emailType: 'Booking Request', receivedAt: '2026-01-01T00:00:00Z' }],
      mode: 'Sea-LCL',
      conversationId: null,
      conflicts: [],
      evidenceIds: ['ev-lk'],
    })
    // decoy must not pollute candidates
    await committer.apply({
      fields: { so_no: 'SO-DECOY' },
      pos: [],
      matchKeys: { so_no: 'SO-DECOY' },
      emailTypes: ['Booking Request'],
      events: [{ emailType: 'Booking Request', receivedAt: '2026-01-01T00:00:00Z' }],
      mode: 'Sea-LCL',
      conversationId: null,
      conflicts: [],
      evidenceIds: ['ev-d'],
    })
    const res = await shipments.lookupByMatchKey({ booking_no: 'BK-LK' })
    expect(res.candidates).toHaveLength(1)
    expect((res.candidates[0] as { id: string }).id).toBe(a.shipmentId)
    expect((res.candidates[0] as { matchedBy: string }).matchedBy).toBe('strong_key')
  })

  it('finds by shared PO with different punctuation (po_number_norm index)', async () => {
    await committer.apply({
      fields: {},
      pos: ['FEL-GZ-OSA-2842'],
      matchKeys: {},
      emailTypes: ['Booking Request'],
      events: [{ emailType: 'Booking Request', receivedAt: '2026-01-01T00:00:00Z' }],
      mode: 'Sea-LCL',
      conversationId: 'c-po-lk',
      conflicts: [],
      evidenceIds: ['ev-po'],
    })
    const res = await shipments.lookupByMatchKey({ customer_po: 'FEL GZ OSA 2842' })
    expect(res.candidates).toHaveLength(1)
    expect((res.candidates[0] as { matchedBy: string }).matchedBy).toBe('po')
  })

  it('does NOT find a leg that only has matchKeys JSON and no shipment_match_keys index', async () => {
    // Documents the Increment 3 contract: the candidate query reads the INDEX, not the JSON bag.
    // A raw insert that skips writeMatchKeyIndex is invisible to the matcher (same as a failed backfill).
    const bk = await db
      .insertInto('bookings')
      .values({ jobNo: 'JOB-NOIDX', status: 'ACTIVE' })
      .outputAll('inserted')
      .executeTakeFirstOrThrow()
    await db
      .insertInto('shipments')
      .values({ bookingId: bk.id, legNo: 1, matchKeys: JSON.stringify({ so_no: 'SO-NOIDX' }) })
      .execute()
    const res = await shipments.lookupByMatchKey({ so_no: 'SO-NOIDX' })
    expect(res.candidates).toHaveLength(0)
  })
})
