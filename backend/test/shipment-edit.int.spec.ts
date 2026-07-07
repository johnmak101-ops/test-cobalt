import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '../src/db/contracts'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import { ShipmentsService } from '../src/shipments/shipments.service'

let db: TestDB
let service: ShipmentsService
let actorId: string

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  const r = repos(db)
  service = new ShipmentsService(r.shipment, r.booking, r.fieldLock, r.audit)
})
afterAll(closeTestDb)
beforeEach(async () => {
  await resetDb(db)
  const [u] = await db
    .insert(schema.users)
    .values({ email: 'e@cobalt.hk', name: 'Editor', passwordHash: 'x', role: 'EDITOR' })
    .returning()
  actorId = u.id
})

async function seedLeg() {
  const [bk] = await db.insert(schema.bookings).values({ jobNo: 'JOB-E-1' }).returning()
  const [leg] = await db.insert(schema.shipments).values({ bookingId: bk.id, legNo: 1 }).returning()
  return leg
}

describe('ShipmentsService.editFields — the human note feeds agent-soul iteration', () => {
  it("writes the reviewer's note onto each edited field's audit row", async () => {
    const leg = await seedLeg()
    const res = await service.editFields(
      leg.id,
      { soNo: 'FIXED-SO' },
      actorId,
      'booking came off the SO line — use the CW# on the booking confirmation',
    )
    expect(res.edited).toContain('soNo')

    const audit = await db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, leg.id))
    const soRow = audit.find((a) => a.field === 'soNo')
    expect(soRow?.note).toBe('booking came off the SO line — use the CW# on the booking confirmation')
    expect(soRow?.sourceType).toBe('manual')
    expect(soRow?.actorUserId).toBe(actorId)
  })

  it('falls back to the generic marker when no note is supplied (legacy callers)', async () => {
    const leg = await seedLeg()
    await service.editFields(leg.id, { soNo: 'X' }, actorId)
    const audit = await db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, leg.id))
    expect(audit.find((a) => a.field === 'soNo')?.note).toBe('edited on shipment detail')
  })

  it('treats a whitespace-only note as no note (falls back)', async () => {
    const leg = await seedLeg()
    await service.editFields(leg.id, { soNo: 'Y' }, actorId, '   ')
    const audit = await db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, leg.id))
    expect(audit.find((a) => a.field === 'soNo')?.note).toBe('edited on shipment detail')
  })
})
