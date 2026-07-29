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

/** 2026-01-20 — first AWB. Same thread; claims the nine plus 28770, states 28639.
 *  Its subject states only 28642/28630/28639/28747 — the rest were SWEPT off a programme-wide
 *  attachment whose rows inherited this AWB. Measured: `posInferred` = those seven. */
const awb1 = (): ReconGroup =>
  g({
    fields: { customer_po: '28642', hbl_awb_fcr_no: 'GZL26258522' },
    pos: [...NINE, '28770'],
    posStated: ['28639'],
    posInferred: ['28631', '28643', '28710', '28735', '28739', '28740', '28770'],
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

  it('CURED (0029): the stated claim takes its POs back off the sweep', async () => {
    await committer.apply(earlyRequest())
    const one = await committer.apply(awb1())
    const two = await committer.apply(awb2())

    // 28739/28740 rode leg 1 only because a programme-wide attachment row inherited its AWB
    // (posInferred). AWB-2 NAMES them in its own subject, so the stated claim displaces the sweep.
    expect(await posOfLeg(two.shipmentId)).toEqual(['28739', '28740'])

    const s1 = await posOfLeg(one.shipmentId)
    for (const po of ['28739', '28740']) expect(s1).not.toContain(po)

    // 28747 is the one PO BOTH AWB subjects name — `…PO28747等` on 01-20 and `PO28739_PO28747_PO28740`
    // on 01-31. Two STATED claims, so the rule deliberately does not fight: leg 1 keeps it and the
    // collision is flagged for a human. Gold puts 28747 on S2, so this is 2 of its 3 POs, by design.
    expect(s1).toContain('28747')
  })

  it('the losing leg records the move — a PO leaving a shipment is never silent', async () => {
    await committer.apply(earlyRequest())
    const one = await committer.apply(awb1())
    await committer.apply(awb2())

    const rows = await db
      .selectFrom('changeLog')
      .where('entityId', '=', one.shipmentId)
      .where('field', '=', 'shipment_pos')
      .selectAll()
      .execute()
    expect(rows.map((r) => r.oldValue).sort()).toEqual(['28739', '28740'])
    expect(rows.every((r) => /swept it up without stating it/.test(r.note ?? ''))).toBe(true)
  })

  it('an INFERRED claim never displaces a STATED one (one-directional)', async () => {
    // AWB-2 first and stating its POs; AWB-1's sweep must NOT take them back.
    const two = await committer.apply(awb2())
    const one = await committer.apply(awb1())

    expect(await posOfLeg(two.shipmentId)).toEqual(['28739', '28740', '28747'])
    const s1 = await posOfLeg(one.shipmentId)
    for (const po of ['28739', '28740']) expect(s1).not.toContain(po)
  })
})
