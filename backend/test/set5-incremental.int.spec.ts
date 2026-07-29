/**
 * Email Set 5, committed the way production actually receives it: one email at a time, in date order.
 *
 * The three decisions below are NOT invented — they are what `buildDecisions` emits per email from the
 * local corpus after cobalt-queue#291, measured with `_probe-set5-topology.ts --only=<file>`:
 *
 *   20260116_1111  (no strong id)  pos=[28630,28631,28642,28643,28710,28735,28739,28740,28747]
 *   20260120_1609  GZL26258522     pos=[…same nine…, 28770]   posStated=[28639]
 *   20260131_1052  GZL26261147     pos=[28739,28740,28747]
 *
 * Gold (`fixtures/gold/demo-spines.json`) wants TWO air legs: S1 GZL26258522, and S2 GZL26261147
 * carrying 28739 / 28747 / 28740. This pins what the committer actually produces from that sequence.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import { CommitterService, type ReconGroup } from '../src/reconcile/committer.service'

let db: TestDB
let committer: CommitterService

const NINE = ['28630', '28631', '28642', '28643', '28710', '28735', '28739', '28740', '28747']

const g = (over: Partial<ReconGroup>): ReconGroup => ({
  fields: {},
  pos: [],
  matchKeys: {},
  emailTypes: ['Booking Request'],
  events: [{ emailType: 'Booking Request', receivedAt: '2026-01-16T03:11:00Z' }],
  mode: 'Air',
  conflicts: [],
  evidenceIds: [],
  conversationId: null,
  ...over,
})

/** 2026-01-16 — the booking request naming nine POs. No booking/SO/HBL issued yet. */
const earlyRequest = (): ReconGroup =>
  g({
    fields: { customer_po: '28631' },
    pos: NINE,
    matchKeys: { customer_po: '28631', conversation_id: 'WYSE MACFUN 30-Jan' },
    conversationId: 'WYSE MACFUN 30-Jan',
    evidenceIds: ['ev-early'],
  })

/** 2026-01-20 — first AWB. Same thread; claims the nine plus 28770, states 28639. */
const awb1 = (): ReconGroup =>
  g({
    fields: { customer_po: '28642', hbl_awb_fcr_no: 'GZL26258522' },
    pos: [...NINE, '28770'],
    posStated: ['28639'],
    matchKeys: { customer_po: '28642', hbl_awb_fcr_no: 'GZL26258522', conversation_id: 'WYSE MACFUN 30-Jan' },
    conversationId: 'WYSE MACFUN 30-Jan',
    events: [{ emailType: 'Booking Request', receivedAt: '2026-01-20T08:09:00Z' }],
    evidenceIds: ['ev-awb1'],
  })

/** 2026-01-31 — second AWB, its own subject/thread, carrying only its three POs. */
const awb2 = (): ReconGroup =>
  g({
    fields: { customer_po: '28739', hbl_awb_fcr_no: 'GZL26261147' },
    pos: ['28739', '28740', '28747'],
    matchKeys: { customer_po: '28739', hbl_awb_fcr_no: 'GZL26261147', conversation_id: 'WYSE MACFUN 07-Feb' },
    conversationId: 'WYSE MACFUN 07-Feb',
    events: [{ emailType: 'Booking Request', receivedAt: '2026-01-31T02:52:00Z' }],
    evidenceIds: ['ev-awb2'],
  })

const posOfLeg = async (shipmentId: string): Promise<string[]> =>
  (
    await db
      .selectFrom('shipmentPos')
      .innerJoin('purchaseOrders', 'purchaseOrders.id', 'shipmentPos.poId')
      .where('shipmentPos.shipmentId', '=', shipmentId)
      .select('purchaseOrders.poNumber')
      .execute()
  )
    .map((r) => r.poNumber)
    .sort()

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  const r = repos(db)
  committer = new CommitterService(r.masters, r.booking, r.shipment, r.fieldLock, r.audit, r.evidence, r.purchaseOrder, r.settings)
})
afterAll(closeTestDb)
beforeEach(() => resetDb(db))

describe('Set 5 committed incrementally (the production arrival order)', () => {
  it('the booking request alone is ONE nascent leg holding all nine POs', async () => {
    const a = await committer.apply(earlyRequest())
    expect(await db.selectFrom('bookings').selectAll().execute()).toHaveLength(1)
    expect(await posOfLeg(a.shipmentId)).toEqual([...NINE].sort())
  })

  it('the first AWB ADOPTS that nascent leg rather than minting a booking', async () => {
    const early = await committer.apply(earlyRequest())
    const one = await committer.apply(awb1())

    expect(one.shipmentId).toBe(early.shipmentId)
    expect(await db.selectFrom('bookings').selectAll().execute()).toHaveLength(1)
    const leg = await db.selectFrom('shipments').where('id', '=', one.shipmentId).selectAll().executeTakeFirstOrThrow()
    expect(leg.hblAwbFcrNo).toBe('GZL26258522')
  })

  it('the full sequence settles on TWO legs — one per AWB (the spine is right)', async () => {
    await committer.apply(earlyRequest())
    await committer.apply(awb1())
    const two = await committer.apply(awb2())

    const legs = await db.selectFrom('shipments').selectAll().execute()
    expect(legs).toHaveLength(2)
    expect(legs.map((l) => l.hblAwbFcrNo).sort()).toEqual(['GZL26258522', 'GZL26261147'])
    expect(two.shipmentId).toBe(legs.find((l) => l.hblAwbFcrNo === 'GZL26261147')!.id)
  })

  it('KNOWN GAP: every PO sticks to leg 1; the second AWB commits with NO cargo', async () => {
    await committer.apply(earlyRequest())
    const one = await committer.apply(awb1())
    const two = await committer.apply(awb2())

    // The booking request named all nine POs, and AWB-1 adopted that leg while still naming all nine —
    // both BEFORE AWB-2 existed to claim its three. By the time AWB-2 arrives the POs are spoken for,
    // and it commits as a leg with nothing on it. Gold wants 28739/28747/28740 HERE, not on leg 1.
    expect(await posOfLeg(two.shipmentId)).toEqual([])
    const s1 = await posOfLeg(one.shipmentId)
    for (const po of ['28739', '28740', '28747']) expect(s1).toContain(po)

    // Pinning the whole allocation so a fix to the retraction path shows up as a diff here.
    expect(s1).toEqual([...NINE, '28770'].sort())
  })
})
