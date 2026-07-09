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
  committer = new CommitterService(r.masters, r.booking, r.shipment, r.fieldLock, r.audit, r.evidence, r.purchaseOrder)
  svc = new ShipmentsService(r.shipment, r.booking, r.fieldLock, r.audit, committer)
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
    // human-entered fields are locked (human-wins)
    const locks = await db.selectFrom('fieldLocks').where('entityId', '=', res.id).selectAll().execute()
    const locked = new Set(locks.map((l) => l.field))
    expect(locked.has('bookingNo')).toBe(true)
    expect(locked.has('qty')).toBe(true)
  })

  it('the agent later UPDATES the human-created shipment (upsert by booking_no, no duplicate) and cannot overwrite a locked value', async () => {
    const created = await svc.createManual({ bookingNo: 'MAN-2', qty: 100, qtyUnit: 'cartons' }, null)
    // a real SO email arrives later carrying the same booking_no + a new ETD and a DIFFERENT qty
    const res = await committer.apply(
      agentGroup({ matchKeys: { booking_no: 'MAN-2' }, fields: { booking_no: 'MAN-2', etd: '2026-08-01', qty: 999 } }),
    )
    expect(res.shipmentId).toBe(created.id) // found the human leg by strong key → amended, not duplicated
    expect(res.action).toBe('amend_fields')
    expect(res.skippedLockedFields).toContain('qty')
    const [leg] = await db.selectFrom('shipments').where('id', '=', created.id).selectAll().execute()
    expect(leg.etd).not.toBeNull() // agent FILLED the gap
    expect(leg.qty).toBe(100) // human value PRESERVED — never overwritten to 999
    expect(await db.selectFrom('shipments').selectAll().execute()).toHaveLength(1) // no duplicate leg
  })

  it('rejects a create with neither an identity nor a PO', async () => {
    await expect(svc.createManual({ consigneeName: 'Someone' }, null)).rejects.toThrow()
  })
})
