import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import { CommitterService, type ReconGroup } from '../src/reconcile/committer.service'

/**
 * INCREMENT 2 — the read-side swap: `committer.apply` no longer scans `allLegs()` for the common
 * (identified) path; it asks the DB for a candidate superset via the indexed `shipment_match_keys`
 * (strong keys, 0003) ∪ `purchase_orders.po_number_norm` (shared PO, 0004), then runs the SAME pure
 * `findExistingLeg` over it. These specs prove the candidate set is a PROVABLE SUPERSET so no match is
 * ever missed (a miss would mint a duplicate shipment).
 */
let db: TestDB
let committer: CommitterService
let shipment: ReturnType<typeof repos>['shipment']

const group = (over: Partial<ReconGroup> = {}): ReconGroup => ({
  fields: {},
  pos: [],
  matchKeys: {},
  emailTypes: ['Booking Request'],
  events: [{ emailType: 'Booking Request', receivedAt: '2026-01-01T00:00:00Z' }],
  mode: 'Sea-LCL',
  conversationId: null,
  conflicts: [],
  evidenceIds: ['ev-1'],
  ...over,
})

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  const r = repos(db)
  shipment = r.shipment
  committer = new CommitterService(r.masters, r.booking, r.shipment, r.fieldLock, r.audit, r.evidence, r.purchaseOrder, r.settings)
})
afterAll(closeTestDb)
beforeEach(() => resetDb(db))

describe('ShipmentRepository.candidateLegs (indexed superset of findExistingLeg inputs)', () => {
  it('returns a leg that shares a strong key (via shipment_match_keys)', async () => {
    const a = await committer.apply(group({ matchKeys: { booking_no: 'BK-A' }, fields: { booking_no: 'BK-A' } }))
    await committer.apply(group({ matchKeys: { so_no: 'SO-OTHER' }, fields: { so_no: 'SO-OTHER' } })) // decoy
    const cands = await shipment.candidateLegs([{ type: 'booking_no', value: 'BKA' }], [])
    expect(cands.map((l) => l.id)).toContain(a.shipmentId)
  })

  it('returns a PO-only leg whose stored (RAW, hyphenated) PO matches the NORMALIZED query key', async () => {
    // the superset trap: PO stored 'FEL-GZ-OSA-2842' (raw) must be found by the normalized key 'FELGZOSA2842'
    const a = await committer.apply(group({ pos: ['FEL-GZ-OSA-2842'], conversationId: 'c-a' }))
    const cands = await shipment.candidateLegs([], ['FELGZOSA2842'])
    expect(cands.map((l) => l.id)).toContain(a.shipmentId)
    // and the write side actually persisted the normalized key
    const po = await db.selectFrom('purchaseOrders').where('poNumber', '=', 'FEL-GZ-OSA-2842').selectAll().executeTakeFirstOrThrow()
    expect(po.poNumberNorm).toBe('FELGZOSA2842')
  })

  it('does NOT return unrelated legs (it filters — not a disguised allLegs)', async () => {
    const keyed = await committer.apply(group({ matchKeys: { booking_no: 'BK-K' }, fields: { booking_no: 'BK-K' } }))
    const poOnly = await committer.apply(group({ pos: ['PO-Z'], conversationId: 'c-z' }))
    // query for a strong key only → the PO-only leg must NOT appear
    const cands = await shipment.candidateLegs([{ type: 'booking_no', value: 'BKK' }], [])
    expect(cands.map((l) => l.id)).toContain(keyed.shipmentId)
    expect(cands.map((l) => l.id)).not.toContain(poOnly.shipmentId)
  })

  it('unions both halves (strong-key ∪ shared-PO)', async () => {
    const keyed = await committer.apply(group({ matchKeys: { mbl: 'MBL-1' }, fields: { mbl: 'MBL-1' } }))
    const poOnly = await committer.apply(group({ pos: ['PO-U'], conversationId: 'c-u' }))
    const cands = await shipment.candidateLegs([{ type: 'mbl', value: 'MBL1' }], ['POU'])
    const ids = cands.map((l) => l.id)
    expect(ids).toContain(keyed.shipmentId)
    expect(ids).toContain(poOnly.shipmentId)
  })

  it('returns [] when given no keys and no POs', async () => {
    await committer.apply(group({ matchKeys: { booking_no: 'BK-N' }, fields: { booking_no: 'BK-N' } }))
    expect(await shipment.candidateLegs([], [])).toEqual([])
  })
})

describe('CommitterService.apply — candidate-query swap preserves matching (integration)', () => {
  it('PO-only leg is AMENDED (not duplicated) when a later email states the same PO with different punctuation', async () => {
    const a = await committer.apply(group({ pos: ['FEL-GZ-OSA-2842'], conversationId: 'c-a' }))
    // second email: SAME logical PO, different punctuation, still no strong identity
    const b = await committer.apply(group({ pos: ['FEL GZ OSA 2842'], conversationId: 'c-b' }))
    expect(b.action).toBe('amend_fields')
    expect(b.shipmentId).toBe(a.shipmentId)
    expect(await db.selectFrom('bookings').selectAll().execute()).toHaveLength(1)
  })

  it('nascent PO-only leg gains its first strong id via the shared PO (no duplicate)', async () => {
    const a = await committer.apply(group({ pos: ['PO-NAS'], conversationId: 'c-1' }))
    const b = await committer.apply(group({ pos: ['PO-NAS'], matchKeys: { booking_no: 'BK-NAS' }, fields: { booking_no: 'BK-NAS' } }))
    expect(b.shipmentId).toBe(a.shipmentId)
    expect(await db.selectFrom('bookings').selectAll().execute()).toHaveLength(1)
  })

  it('zero-identity leg is amended via conversationId (allLegs fallback path preserved)', async () => {
    const a = await committer.apply(group({ pos: [], matchKeys: {}, conversationId: 'CONV-Z' }))
    const b = await committer.apply(group({ pos: [], matchKeys: {}, conversationId: 'CONV-Z' }))
    expect(b.shipmentId).toBe(a.shipmentId)
    expect(await db.selectFrom('bookings').selectAll().execute()).toHaveLength(1)
  })

  it('a shared strong key but a DIFFERENT PO still does NOT merge bookings (guard preserved)', async () => {
    await committer.apply(group({ pos: ['PO-A'], matchKeys: { so_no: 'SAME' }, fields: { so_no: 'SAME' } }))
    const res = await committer.apply(group({ pos: ['PO-B'], matchKeys: { so_no: 'SAME' }, fields: { so_no: 'SAME' } }))
    expect(res.action).toBe('create_booking')
    expect(await db.selectFrom('bookings').selectAll().execute()).toHaveLength(2)
  })
})
