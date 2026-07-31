import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import { CommitterService, type ReconGroup } from '../src/reconcile/committer.service'
import { ShipmentsService } from '../src/shipments/shipments.service'

let db: TestDB
let committer: CommitterService
let svc: ShipmentsService

/** A minimal agent decision group (mirrors the machine POST /api/decisions path). */
const agentGroup = (over: Partial<ReconGroup> = {}): ReconGroup => ({
  fields: {},
  pos: [],
  matchKeys: {},
  emailTypes: ['SO'],
  events: [{ emailType: 'SO', receivedAt: '2026-08-01T00:00:00Z' }],
  mode: 'Sea-LCL',
  conversationId: 'agent-conv',
  conflicts: [],
  evidenceIds: ['ev-x'],
  ...over,
})

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  const r = repos(db)
  committer = new CommitterService(r.masters, r.booking, r.shipment, r.fieldLock, r.audit, r.evidence, r.purchaseOrder, r.settings)
  const queueLearning = { postCorrection: async () => undefined } as never
  svc = new ShipmentsService(r.shipment, r.booking, r.fieldLock, r.audit, committer, queueLearning)
})
afterAll(closeTestDb)
beforeEach(() => resetDb(db))

describe('ShipmentsService.createManual — human-created shipments (integration)', () => {
  it('mints a provisional SHIPMENT leg from a human form and locks the entered fields', async () => {
    const res = await svc.createManual(
      { bookingNo: 'MAN-1', qty: 286, qtyUnit: 'cartons', grossWeight: 2965.4, measurement: 20.54, pos: ['PO-M1'] },
      null,
    )
    const [leg] = await db.selectFrom('shipments').where('id', '=', res.id).selectAll().execute()
    expect(leg.kind).toBe('SHIPMENT')
    expect(leg.reviewStatus).toBe('provisional') // human-created → lands in the Review queue
    expect(leg.bookingNo).toBe('MAN-1')
    expect(leg.qty).toBe(286)
    // human-entered fields get a lock row (their value on record — not a barrier against the agent)
    const locks = await db.selectFrom('fieldLocks').where('entityId', '=', res.id).selectAll().execute()
    const locked = new Set(locks.map((l) => l.field))
    expect(locked.has('bookingNo')).toBe(true)
    expect(locked.has('qty')).toBe(true)
  })

  it('the agent later UPDATES the human-created shipment (upsert by booking_no, no duplicate); a newer email overrides a locked value but flags it contested', async () => {
    const created = await svc.createManual({ bookingNo: 'MAN-2', qty: 100, qtyUnit: 'cartons' }, null)
    // a real SO email arrives later carrying the same booking_no + a new ETD and a DIFFERENT qty
    const res = await committer.apply(
      agentGroup({ matchKeys: { booking_no: 'MAN-2' }, fields: { booking_no: 'MAN-2', etd: '2026-08-01', qty: 999 } }),
    )
    expect(res.shipmentId).toBe(created.id) // found the human leg by strong key → amended, not duplicated
    expect(res.action).toBe('amend_fields')
    expect(res.supersededLockedFields).toContain('qty')
    const [leg] = await db.selectFrom('shipments').where('id', '=', created.id).selectAll().execute()
    expect(leg.etd).not.toBeNull() // agent FILLED the gap
    expect(leg.qty).toBe(999) // newer email wins — flagged CONTESTED, not silently dropped
    expect(await db.selectFrom('shipments').selectAll().execute()).toHaveLength(1) // no duplicate leg
  })

  it('rejects a create with neither an identity nor a PO', async () => {
    await expect(svc.createManual({ consigneeName: 'Someone' }, null)).rejects.toThrow()
  })
})

/**
 * 0028 — the committer must not act automatically on a leg a PERSON typed. Both situations below end
 * with TWO legs and a review reason naming the other one, because whether they are one shipment is a
 * judgement about physical cargo that the data genuinely does not settle.
 */
describe('createManual — a hand-typed leg is protected from the committer, not hidden from it', () => {
  const reasonsOf = async (id: string): Promise<string[]> => {
    const [leg] = await db.selectFrom('shipments').where('id', '=', id).selectAll().execute()
    return (leg?.reviewReasons ?? []) as string[]
  }
  const legsNow = () => db.selectFrom('shipments').selectAll().execute()

  it('a conflicting re-key no longer DISMISSES the human row (it reports instead)', async () => {
    // The operator typed the booking number they had plus an SO number that turns out to be the
    // shipment reference. Before 0028 the next email retired this leg outright — and its field locks,
    // which live per shipment id and do not travel to the successor, went with it.
    const typed = await svc.createManual({ bookingNo: 'BK-CLASH', soNo: 'SHIPMENT-REF' }, null)
    const res = await committer.apply(
      agentGroup({
        matchKeys: { booking_no: 'BK-CLASH', so_no: 'REAL-ORDER-NO' },
        fields: { booking_no: 'BK-CLASH', so_no: 'REAL-ORDER-NO' },
      }),
    )
    expect(res.shipmentId).not.toBe(typed.id) // the SO conflict still blocks a silent amend

    const [human] = await db.selectFrom('shipments').where('id', '=', typed.id).selectAll().execute()
    expect(human!.dismissedAt).toBeNull() // ← the fix: still on the desk
    expect(human!.linkedShipmentId).toBeNull()
    expect(await legsNow()).toHaveLength(2)

    const reasons = await reasonsOf(res.shipmentId)
    expect(reasons.some((r) => /^possible duplicate of .*entered by hand/i.test(r))).toBe(true)
  })

  it('an email that can only reach the human leg by PO says so, instead of quietly minting a twin', async () => {
    // The booking mail was never ingested, so the operator entered the booking number by hand. The
    // forwarder's later email cites its HBL and the same PO — but not that booking number, so the
    // shared-PO branch of findExistingLeg (which needs one side to have NO identity) cannot fire.
    const typed = await svc.createManual({ bookingNo: 'BK-PO', pos: ['PO-DUP-1'] }, null)
    const res = await committer.apply(
      agentGroup({
        matchKeys: { hbl_awb_fcr_no: 'HBL-DUP-9' },
        fields: { hbl_awb_fcr_no: 'HBL-DUP-9' },
        pos: ['PO-DUP-1'],
      }),
    )
    expect(res.shipmentId).not.toBe(typed.id) // still not merged — that judgement is the operator's
    expect(await legsNow()).toHaveLength(2)

    const reasons = await reasonsOf(res.shipmentId)
    expect(reasons.some((r) => /^possible duplicate of .*shares PO PO-DUP-1/i.test(r))).toBe(true)
    // it names the OTHER leg's job number, which is what the operator searches on to compare them
    const [bk] = await db.selectFrom('bookings').selectAll().orderBy('jobNo').execute()
    expect(reasons.join(' ')).toContain(bk!.jobNo)
  })

  it('the warning CLEARS itself once the pair is resolved — never a sticky duplicate flag', async () => {
    const typed = await svc.createManual({ bookingNo: 'BK-CLEAR', pos: ['PO-CLEAR-1'] }, null)
    const group = agentGroup({
      matchKeys: { hbl_awb_fcr_no: 'HBL-CLEAR' },
      fields: { hbl_awb_fcr_no: 'HBL-CLEAR' },
      pos: ['PO-CLEAR-1'],
    })
    const res = await committer.apply(group)
    expect((await reasonsOf(res.shipmentId)).some((r) => /^possible duplicate of/i.test(r))).toBe(true)

    // the operator folds the hand-typed leg into the agent's (review desk link action)
    await db
      .updateTable('shipments')
      .set({ dismissedAt: new Date(), linkedShipmentId: res.shipmentId })
      .where('id', '=', typed.id)
      .execute()

    // re-ingest of the same email amends the same leg — and the reason is gone, not accumulated
    const again = await committer.apply(group)
    expect(again.shipmentId).toBe(res.shipmentId)
    expect((await reasonsOf(res.shipmentId)).some((r) => /^possible duplicate of/i.test(r))).toBe(false)
  })

  it('two AGENT legs sharing a PO stay silent — that is the ordinary case, not a duplicate', async () => {
    await committer.apply(
      agentGroup({ matchKeys: { booking_no: 'AG-1' }, fields: { booking_no: 'AG-1' }, pos: ['PO-SHARED'] }),
    )
    const second = await committer.apply(
      agentGroup({
        conversationId: 'agent-conv-2',
        matchKeys: { hbl_awb_fcr_no: 'AG-HBL-2' },
        fields: { hbl_awb_fcr_no: 'AG-HBL-2' },
        pos: ['PO-SHARED'],
      }),
    )
    expect((await reasonsOf(second.shipmentId)).some((r) => /^possible duplicate of/i.test(r))).toBe(false)
  })

  it('stamps the provenance so every later commit can tell who made the leg', async () => {
    const typed = await svc.createManual({ bookingNo: 'BK-STAMP' }, null)
    const agent = await committer.apply(agentGroup({ matchKeys: { booking_no: 'AGENT-ONLY' }, fields: { booking_no: 'AGENT-ONLY' } }))
    const rows = await db.selectFrom('shipments').select(['id', 'createdManually']).execute()
    expect(rows.find((r) => r.id === typed.id)!.createdManually).toBe(true)
    expect(rows.find((r) => r.id === agent.shipmentId)!.createdManually).toBe(false)
  })

  it('records the CFS cut-off the form could not reach before', async () => {
    const res = await svc.createManual({ bookingNo: 'BK-CFS', cfsCutoff: '2026-08-03' }, null)
    const [leg] = await db.selectFrom('shipments').where('id', '=', res.id).selectAll().execute()
    expect(leg!.cfsCutoff).not.toBeNull()
  })
})
