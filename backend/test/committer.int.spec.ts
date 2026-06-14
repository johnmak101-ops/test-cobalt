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
