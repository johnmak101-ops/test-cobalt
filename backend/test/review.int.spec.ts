import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '@cobalt/contracts'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import { ReviewService } from '../src/review/review.service'
import { QueueLearningClient } from '../src/review/queue-learning.client'
import { SettingsService } from '../src/settings/settings.service'

let db: TestDB
let review: ReviewService
let settings: SettingsService
let reviewerId: string

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  const r = repos(db)
  review = new ReviewService(r.shipment, r.booking, r.fieldLock, r.audit, new QueueLearningClient())
  settings = new SettingsService(r.settings)
})
afterAll(closeTestDb)
beforeEach(async () => {
  await resetDb(db)
  const [u] = await db
    .insert(schema.users)
    .values({ email: 'r@cobalt.hk', name: 'Reviewer', passwordHash: 'x', role: 'EDITOR' })
    .returning()
  reviewerId = u.id
})

async function seedProvisional(jobNo: string, confidence: number, over: Partial<typeof schema.shipments.$inferInsert> = {}) {
  const [bk] = await db.insert(schema.bookings).values({ jobNo }).returning()
  const [leg] = await db
    .insert(schema.shipments)
    .values({ bookingId: bk.id, legNo: 1, reviewStatus: 'provisional', confidence, reviewReasons: ['conflict: hbl A vs B'], ...over })
    .returning()
  return { bk, leg }
}

describe('ReviewService (integration)', () => {
  it('lists only provisional shipments, lowest confidence first', async () => {
    await seedProvisional('JOB-R-1', 60)
    await seedProvisional('JOB-R-2', 20)
    const [okBk] = await db.insert(schema.bookings).values({ jobNo: 'JOB-OK' }).returning()
    await db.insert(schema.shipments).values({ bookingId: okBk.id, legNo: 1, reviewStatus: 'confirmed', confidence: 95 })

    const q = await review.queue()
    expect(q).toHaveLength(2)
    expect(q[0].confidence).toBe(20) // lowest first = most urgent
    expect(q[0].jobNo).toBe('JOB-R-2')
    expect(q[0].reviewReasons).toContain('conflict: hbl A vs B')
  })

  it('confirm flips to confirmed and records the reviewer + a manual audit', async () => {
    const { leg } = await seedProvisional('JOB-R-1', 40)
    const res = await review.confirm(leg.id, reviewerId)
    expect(res.reviewStatus).toBe('confirmed')

    const [updated] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, leg.id))
    expect(updated.reviewStatus).toBe('confirmed')
    expect(updated.reviewedBy).toBe(reviewerId)
    expect(updated.reviewedAt).not.toBeNull()

    const audit = await db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, leg.id))
    expect(audit.some((a) => a.sourceType === 'manual' && a.actorUserId === reviewerId)).toBe(true)
  })

  it('correct updates a field, locks it (human-wins), audits the reason, and confirms', async () => {
    const { leg } = await seedProvisional('JOB-R-1', 30)
    const res = await review.correct(
      leg.id,
      { fields: { eta: '2026-06-01', soNo: 'FIXED-SO' }, reason: 'forwarder confirmed' },
      reviewerId,
    )
    expect(res.corrected).toEqual(expect.arrayContaining(['eta', 'soNo']))

    const [updated] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, leg.id))
    expect(updated.reviewStatus).toBe('confirmed')
    expect(updated.soNo).toBe('FIXED-SO')
    expect(updated.eta?.toISOString().slice(0, 10)).toBe('2026-06-01')

    const locks = await db.select().from(schema.fieldLocks).where(eq(schema.fieldLocks.entityId, leg.id))
    expect(locks.map((l) => l.field)).toEqual(expect.arrayContaining(['eta', 'soNo']))
    expect(locks.find((l) => l.field === 'soNo')?.lockedBy).toBe(reviewerId)

    const audit = await db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, leg.id))
    expect(audit.some((a) => a.note === 'forwarder confirmed' && a.field === 'soNo')).toBe(true)
  })

  it('the threshold setting persists (admin config)', async () => {
    await settings.setConfidenceThreshold(70, reviewerId)
    expect(await settings.confidenceThreshold()).toBe(70)
  })
})
