/**
 * Set 6 air: the queue emits TWO decisions for ONE shipment, because one email writes the AWB as
 * `A26050003` (bare-A, from the subject) and another as `SZA26050003` (the B/L attachment).
 *
 * Measured with `_probe-leg-fields.ts` — both carry mawb 999-92908152, ELGC / SOUOCE / TCI, PO 1570988:
 *   A26050003     booking_no SZA26050003, so_no SOKLSO023890
 *   SZA26050003   no booking/so
 *
 * Does the committer collapse them, or does one shipment become two legs?
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import { CommitterService, type ReconGroup } from '../src/reconcile/committer.service'

let db: TestDB
let committer: CommitterService

const base = (over: Partial<ReconGroup>): ReconGroup => ({
  fields: {},
  pos: ['1570988'],
  matchKeys: {},
  emailTypes: ['Booking Request'],
  events: [{ emailType: 'Booking Request', receivedAt: '2026-05-05T00:00:00Z' }],
  mode: 'Air',
  conversationId: 'ELGC 1570988 air',
  conflicts: [],
  evidenceIds: [],
  ...over,
})

/** the attachment form */
const sza = (): ReconGroup =>
  base({
    fields: { customer_po: '1570988', hbl_awb_fcr_no: 'SZA26050003', mawb: '999-92908152' },
    matchKeys: { customer_po: '1570988', hbl_awb_fcr_no: 'SZA26050003' },
    evidenceIds: ['ev-sza'],
  })

/** the bare-A subject form, same shipment */
const bareA = (): ReconGroup =>
  base({
    fields: {
      customer_po: '1570988',
      hbl_awb_fcr_no: 'A26050003',
      booking_no: 'SZA26050003',
      so_no: 'SOKLSO023890',
      mawb: '999-92908152',
    },
    matchKeys: { customer_po: '1570988', hbl_awb_fcr_no: 'A26050003', booking_no: 'SZA26050003', so_no: 'SOKLSO023890' },
    events: [{ emailType: 'Booking Request', receivedAt: '2026-05-06T00:00:00Z' }],
    evidenceIds: ['ev-bare-a'],
  })

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  const r = repos(db)
  committer = new CommitterService(r.masters, r.booking, r.shipment, r.fieldLock, r.audit, r.evidence, r.purchaseOrder, r.settings)
})
afterAll(closeTestDb)
beforeEach(() => resetDb(db))

describe('Set 6 air — the A26050003 / SZA26050003 AWB alias', () => {
  it('collapses to ONE leg (attachment form first)', async () => {
    const a = await committer.apply(sza())
    const b = await committer.apply(bareA())

    expect(b.shipmentId).toBe(a.shipmentId)
    expect(await db.selectFrom('shipments').selectAll().execute()).toHaveLength(1)
    expect(await db.selectFrom('bookings').selectAll().execute()).toHaveLength(1)
  })

  it('collapses to ONE leg in the other arrival order too', async () => {
    const a = await committer.apply(bareA())
    const b = await committer.apply(sza())

    expect(b.shipmentId).toBe(a.shipmentId)
    expect(await db.selectFrom('shipments').selectAll().execute()).toHaveLength(1)
  })

  it('the single leg keeps BOTH forms as searchable identity', async () => {
    await committer.apply(sza())
    const b = await committer.apply(bareA())
    const leg = await db.selectFrom('shipments').where('id', '=', b.shipmentId).selectAll().executeTakeFirstOrThrow()
    // whichever form the column ends on, the shipment is one row carrying one PO
    expect(leg.hblAwbFcrNo).toMatch(/^(SZA)?A?26050003$/)
    const pos = await db.selectFrom('shipmentPos').where('shipmentId', '=', b.shipmentId).selectAll().execute()
    expect(pos).toHaveLength(1)
  })
})
