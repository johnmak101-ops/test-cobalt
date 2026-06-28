import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '@cobalt/contracts'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import { CommitterService, type ReconGroup } from '../src/reconcile/committer.service'

let db: TestDB
let committer: CommitterService

const group = (over: Partial<ReconGroup> = {}): ReconGroup => ({
  fields: {},
  pos: ['PO-1'],
  matchKeys: { so_no: 'SO-1' },
  emailTypes: ['Booking Request'],
  events: [{ emailType: 'Booking Request', receivedAt: '2026-01-01T00:00:00Z' }],
  mode: 'Sea-LCL',
  conversationId: 'conv-1',
  conflicts: [],
  evidenceIds: ['ev-1'],
  ...over,
})

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  const r = repos(db)
  committer = new CommitterService(r.masters, r.booking, r.shipment, r.fieldLock, r.audit)
})
afterAll(closeTestDb)
beforeEach(() => resetDb(db))

describe('CommitterService (integration, real Postgres)', () => {
  it('creates a booking + leg from a group, mapping fields and deriving state', async () => {
    const res = await committer.apply(group({ fields: { so_no: 'SO-1', hbl_awb_fcr_no: 'H-1' }, emailTypes: ['SO'] }))
    expect(res.action).toBe('create_booking')
    expect(res.state).toBe('CONFIRMED')
    const [leg] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, res.shipmentId))
    expect(leg.soNo).toBe('SO-1')
    expect(leg.mode).toBe('SEA_LCL')
    expect(await db.select().from(schema.bookings)).toHaveLength(1)
  })

  it('is idempotent: the same group twice updates one leg (no duplicate booking)', async () => {
    const g = group({ fields: { so_no: 'SO-9' } })
    const a = await committer.apply(g)
    const b = await committer.apply(g)
    expect(b.action).toBe('amend_fields')
    expect(b.bookingId).toBe(a.bookingId)
    expect(await db.select().from(schema.bookings)).toHaveLength(1)
    expect(await db.select().from(schema.shipments)).toHaveLength(1)
  })

  it('human-wins: a locked field is never overwritten by the agent', async () => {
    const a = await committer.apply(group({ fields: { so_no: 'AGENT-SO' } }))
    await db.update(schema.shipments).set({ soNo: 'HUMAN-SO' }).where(eq(schema.shipments.id, a.shipmentId))
    await db
      .insert(schema.fieldLocks)
      .values({ entityType: 'shipment', entityId: a.shipmentId, field: 'soNo', lockedValue: 'HUMAN-SO' })
    const b = await committer.apply(group({ fields: { so_no: 'AGENT-SO-2' } }))
    expect(b.skippedLockedFields).toContain('soNo')
    const [leg] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, a.shipmentId))
    expect(leg.soNo).toBe('HUMAN-SO')
  })

  it('PO-guard: a shared strong key but a different PO does NOT merge bookings', async () => {
    await committer.apply(group({ pos: ['PO-A'], matchKeys: { so_no: 'SAME' } }))
    const res = await committer.apply(group({ pos: ['PO-B'], matchKeys: { so_no: 'SAME' } }))
    expect(res.action).toBe('create_booking')
    expect(await db.select().from(schema.bookings)).toHaveLength(2)
  })

  it('writes an audit row on create', async () => {
    await committer.apply(group())
    const audit = await db.select().from(schema.changeLog)
    expect(audit.length).toBeGreaterThan(0)
    expect(audit.some((a) => a.changeType === 'create' && a.sourceType === 'agent')).toBe(true)
  })
})

describe('CommitterService — co-valid customer parties (integration)', () => {
  // master_resolution is NOT in resetDb's truncate list → clear it + seed customers per test
  async function seedAEGroup(extraCustomers: { code: string; name: string }[] = []) {
    await db.delete(schema.masterResolution)
    await db.insert(schema.customers).values([
      { code: 'AEOW', name: 'AEO MANAGEMENT CO.' },
      { code: 'BLUI', name: 'BLUE STAR IMPORTS L.P.' },
      ...extraCustomers,
    ])
    await db.insert(schema.masterResolution).values([
      { kind: 'customer_group', lhs: 'AEOW', rhs: 'AMERICAN_EAGLE', status: 'approved', source: 'seed' },
      { kind: 'customer_group', lhs: 'BLUI', rhs: 'AMERICAN_EAGLE', status: 'approved', source: 'seed' },
      { kind: 'customer_role', lhs: 'AEOW', rhs: 'bill_to', status: 'approved', source: 'seed' },
      { kind: 'customer_role', lhs: 'BLUI', rhs: 'importer_of_record', status: 'approved', source: 'seed' },
    ])
  }

  it('persists bill-to + IOR as parties, primary = bill_to, and DROPS an unrelated party', async () => {
    await seedAEGroup([{ code: 'FENIX', name: 'FENIX OUTDOOR' }])
    const res = await committer.apply(group({
      fields: { customer_code: 'AEOW', so_no: 'SO-AE' },
      matchKeys: { so_no: 'SO-AE' },
      entities: [
        { type: 'customer_code', value: 'AEOW', role: 'bill_to', isPrimary: true, docType: 'Invoice/Billing', rank: 1 },
        { type: 'customer_code', value: 'BLUI', role: 'importer_of_record', isPrimary: false, docType: 'Final B/L', rank: 5 },
        { type: 'customer_code', value: 'FENIX', role: 'other', isPrimary: false, docType: 'Customs', rank: 1 }, // UNRELATED → dropped
      ],
    }))
    const parties = await db.select().from(schema.shipmentParties).where(eq(schema.shipmentParties.shipmentId, res.shipmentId))
    expect(parties.map((p) => p.customerCode).sort()).toEqual(['AEOW', 'BLUI']) // FENIX dropped (no shared group)
    expect(parties.find((p) => p.customerCode === 'AEOW')?.isPrimary).toBe(true)
    expect(parties.find((p) => p.customerCode === 'BLUI')?.isPrimary).toBe(false)
    // booking.customer_id = the bill_to primary (AEOW), never the IOR
    const [bk] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, res.bookingId))
    const [aeow] = await db.select().from(schema.customers).where(eq(schema.customers.code, 'AEOW'))
    expect(bk.customerId).toBe(aeow.id)
  })

  it('re-applying the same decision is idempotent (no duplicate party rows)', async () => {
    await seedAEGroup()
    const g = group({
      fields: { customer_code: 'AEOW', so_no: 'SO-IDEM' },
      matchKeys: { so_no: 'SO-IDEM' },
      entities: [
        { type: 'customer_code', value: 'AEOW', role: 'bill_to', isPrimary: true },
        { type: 'customer_code', value: 'BLUI', role: 'importer_of_record', isPrimary: false },
      ],
    })
    const a = await committer.apply(g)
    await committer.apply(g)
    const parties = await db.select().from(schema.shipmentParties).where(eq(schema.shipmentParties.shipmentId, a.shipmentId))
    expect(parties).toHaveLength(2)
  })

  it('folds an alias (COLEB→COLE) onto booking.customer_id via canonical resolution', async () => {
    await db.delete(schema.masterResolution)
    await db.insert(schema.customers).values([{ code: 'COLE', name: 'COLE BUXTON LTD' }])
    await db.insert(schema.masterResolution).values([
      { kind: 'customer_canonical', lhs: 'COLEB', rhs: 'COLE', status: 'approved', source: 'seed' },
    ])
    const res = await committer.apply(group({ fields: { customer_code: 'COLEB', so_no: 'SO-COLE' }, matchKeys: { so_no: 'SO-COLE' } }))
    const [bk] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, res.bookingId))
    const [cole] = await db.select().from(schema.customers).where(eq(schema.customers.code, 'COLE'))
    expect(bk.customerId).toBe(cole.id) // COLEB resolved to COLE's id
  })

  it('writes no parties when the decision carries none (legacy/single-customer)', async () => {
    await db.delete(schema.masterResolution)
    await db.insert(schema.customers).values([{ code: 'DOCC', name: 'DOCLASSE' }])
    const res = await committer.apply(group({ fields: { customer_code: 'DOCC', so_no: 'SO-SINGLE' }, matchKeys: { so_no: 'SO-SINGLE' } }))
    const parties = await db.select().from(schema.shipmentParties).where(eq(schema.shipmentParties.shipmentId, res.shipmentId))
    expect(parties).toHaveLength(0)
  })
})
