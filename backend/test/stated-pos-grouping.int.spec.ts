/**
 * The WYSE MACFUN air-job over-split, reproduced against a real SQL Server and cured.
 *
 * Prod (Fabric, 2026-07-29) held 13 bookings each with exactly ONE leg. Ten of them were the same air job:
 * one thread, ~3 AWBs, ~10 POs. The gold spine for that job (`fixtures/gold/demo-spines.json`,
 * "Set5 S2 GZL26261147") expects ONE leg carrying POs 28739 / 28747 / 28740 — prod had them as
 * JOB-2026-0008 / 0010 / 0009.
 *
 * Cause: the AWB email states all three POs but anchors `customer_po` on the first, so the decision's `pos`
 * carried only 28739 and `findExistingLeg` could not see the legs holding the other two. `posStated` carries
 * the stated-but-not-committed remainder for MATCHING only.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import { CommitterService, type ReconGroup } from '../src/reconcile/committer.service'

let db: TestDB
let committer: CommitterService

const CONV = 'WYSE MACFUN （ PO28631;PO28643;PO28642等)booking  Air--South Ocean   Guangzhou'

/** A PO-only booking-request leg, exactly as the early thread emails committed them (zero strong id). */
const poOnlyLeg = (po: string): ReconGroup => ({
  fields: { customer_po: po },
  pos: [po],
  matchKeys: { customer_po: po, conversation_id: CONV },
  emailTypes: ['Booking Request'],
  events: [{ emailType: 'Booking Request', receivedAt: '2026-01-20T16:09:00Z' }],
  mode: 'Air',
  conversationId: CONV,
  conflicts: [],
  evidenceIds: [`ev-${po}`],
})

/** The later AWB email: anchors on 28739, STATES 28747 + 28740 alongside it. */
const awbGroup = (over: Partial<ReconGroup> = {}): ReconGroup => ({
  fields: { customer_po: '28739', hbl_awb_fcr_no: 'GZL26261147', warehouse_so: '098-32230564' },
  pos: ['28739'],
  posStated: ['28747', '28740'],
  matchKeys: { customer_po: '28739', hbl_awb_fcr_no: 'GZL26261147', conversation_id: CONV },
  emailTypes: ['Other'],
  events: [{ emailType: 'Other', receivedAt: '2026-02-08T02:00:00Z' }],
  mode: 'Air',
  conversationId: CONV,
  conflicts: [],
  evidenceIds: ['ev-awb'],
  ...over,
})

const bookingCount = async (): Promise<number> => (await db.selectFrom('bookings').selectAll().execute()).length

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  const r = repos(db)
  committer = new CommitterService(r.masters, r.booking, r.shipment, r.fieldLock, r.audit, r.evidence, r.purchaseOrder, r.settings)
})
afterAll(closeTestDb)
beforeEach(() => resetDb(db))

describe('posStated — an AWB reaches the sibling legs holding its other POs', () => {
  it('REGRESSION: without posStated the AWB mints its own booking (the prod 13-booking shape)', async () => {
    const sibling = await committer.apply(poOnlyLeg('28747'))
    const awb = await committer.apply(awbGroup({ posStated: undefined }))

    expect(awb.action).toBe('create_booking')
    expect(awb.shipmentId).not.toBe(sibling.shipmentId)
    expect(await bookingCount()).toBe(2) // ← what prod did
  })

  it('with posStated the AWB MATCHES the stated sibling instead of creating a booking', async () => {
    const sibling = await committer.apply(poOnlyLeg('28747'))
    const awb = await committer.apply(awbGroup())

    expect(awb.shipmentId).toBe(sibling.shipmentId)
    expect(awb.action).not.toBe('create_booking')
    expect(await bookingCount()).toBe(1)
  })

  it('the matched leg GAINS the AWB — the nascent PO-only leg receives its first strong identity', async () => {
    await committer.apply(poOnlyLeg('28747'))
    const awb = await committer.apply(awbGroup())

    const leg = await db.selectFrom('shipments').where('id', '=', awb.shipmentId).selectAll().executeTakeFirstOrThrow()
    expect(leg.hblAwbFcrNo).toBe('GZL26261147')
  })

  it('a STATED PO is never written as cargo — posStated matches, `pos` alone is contents', async () => {
    const sibling = await committer.apply(poOnlyLeg('28747'))
    const awb = await committer.apply(awbGroup())
    expect(awb.shipmentId).toBe(sibling.shipmentId)

    // The booking holds 28747 (the sibling's own PO) + 28739 (the AWB email's committed PO).
    // 28740 was only STATED here — no email has claimed it as contents, so it must NOT appear.
    const pos = await db
      .selectFrom('shipmentPos')
      .innerJoin('purchaseOrders', 'purchaseOrders.id', 'shipmentPos.poId')
      .where('shipmentPos.shipmentId', '=', awb.shipmentId)
      .select('purchaseOrders.poNumber')
      .execute()
    expect(pos.map((p) => p.poNumber).sort()).toEqual(['28739', '28747'])
  })

  it('absorbs ONE pre-split sibling and FLAGS the rest — it does not fold legs on its own', async () => {
    // Two POs were already booked as separate nascent legs before the AWB email arrived.
    const s1 = await committer.apply(poOnlyLeg('28747'))
    const s2 = await committer.apply(poOnlyLeg('28740'))
    const awb = await committer.apply(awbGroup())

    // findExistingLeg returns the FIRST match and stops, so the AWB joins one of them...
    expect([s1.shipmentId, s2.shipmentId]).toContain(awb.shipmentId)
    // ...and the other is NOT silently folded. 2 bookings, down from the 3 prod would have had.
    expect(await bookingCount()).toBe(2)

    // The residual is reported, naming the other job — the desk has the link action.
    const leg = await db.selectFrom('shipments').where('id', '=', awb.shipmentId).selectAll().executeTakeFirstOrThrow()
    const reasons = (leg.reviewReasons ?? []) as string[]
    expect(reasons.some((r) => /likely the same shipment as JOB-/.test(r))).toBe(true)
    expect(reasons.some((r) => /GZL26261147 also covers PO/.test(r))).toBe(true)
  })

  it('HEALTHY PARSE (posStated empty): still flags every nascent leg the B/L covers but did not absorb', async () => {
    // What a good parse of Set 5 actually produces — verified against the local corpus:
    //   --only=20260131_1052 → pos=[28739,28740,28747], posStated=[]
    // The earlier keying used posStated, so this — the common case — raised no flag at all.
    await committer.apply(poOnlyLeg('28747'))
    await committer.apply(poOnlyLeg('28740'))
    const awb = await committer.apply(
      awbGroup({ pos: ['28739', '28740', '28747'], posStated: undefined }),
    )

    const leg = await db.selectFrom('shipments').where('id', '=', awb.shipmentId).selectAll().executeTakeFirstOrThrow()
    const reasons = (leg.reviewReasons ?? []) as string[]
    // one absorbed, ONE residual named
    expect(reasons.filter((r) => /likely the same shipment as JOB-/.test(r))).toHaveLength(1)
    expect(reasons.some((r) => /GZL26261147 also covers PO/.test(r))).toBe(true)
  })

  it('a PO-only group never flags nascent siblings — no B/L means nothing vouches for the link', async () => {
    await committer.apply(poOnlyLeg('28747'))
    // second PO-only email in the same thread: shares no PO, has no B/L → must stay silent
    const second = await committer.apply(poOnlyLeg('28740'))

    const leg = await db.selectFrom('shipments').where('id', '=', second.shipmentId).selectAll().executeTakeFirstOrThrow()
    const reasons = (leg.reviewReasons ?? []) as string[]
    expect(reasons.some((r) => /likely the same shipment/.test(r))).toBe(false)
  })

  it('never bridges a leg that already carries a DIFFERENT strong id (the other AWB stays separate)', async () => {
    // Set5 S1 = GZL26258522, a genuinely different HAWB that also states 28747.
    const s1 = await committer.apply(
      awbGroup({
        fields: { customer_po: '28642', hbl_awb_fcr_no: 'GZL26258522' },
        pos: ['28642'],
        posStated: ['28747'],
        matchKeys: { customer_po: '28642', hbl_awb_fcr_no: 'GZL26258522', conversation_id: CONV },
        evidenceIds: ['ev-s1'],
      }),
    )
    const s2 = await committer.apply(awbGroup())

    expect(s2.shipmentId).not.toBe(s1.shipmentId)
    expect(await bookingCount()).toBe(2) // two AWBs = two legs — gold expects both spines to survive
  })
})
