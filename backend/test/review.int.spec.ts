import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import type { Insertable } from 'kysely'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import type { DB } from '../src/db/kysely/db'
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
  const u = await db
    .insertInto('users')
    .values({ email: 'r@cobalt.hk', name: 'Reviewer', passwordHash: 'x', role: 'EDITOR' })
    .outputAll('inserted')
    .executeTakeFirstOrThrow()
  reviewerId = u.id
})

async function seedProvisional(jobNo: string, confidence: number, over: Partial<Insertable<DB['shipments']>> = {}) {
  const bk = await db.insertInto('bookings').values({ jobNo }).outputAll('inserted').executeTakeFirstOrThrow()
  const leg = await db
    .insertInto('shipments')
    .values({
      bookingId: bk.id,
      legNo: 1,
      reviewStatus: 'provisional',
      confidence,
      reviewReasons: JSON.stringify(['conflict: hbl A vs B']),
      ...over,
    })
    .outputAll('inserted')
    .executeTakeFirstOrThrow()
  return { bk, leg }
}

describe('ReviewService (integration)', () => {
  it('lists only provisional shipments, lowest confidence first', async () => {
    await seedProvisional('JOB-R-1', 60)
    await seedProvisional('JOB-R-2', 20)
    const okBk = await db.insertInto('bookings').values({ jobNo: 'JOB-OK' }).outputAll('inserted').executeTakeFirstOrThrow()
    await db.insertInto('shipments').values({ bookingId: okBk.id, legNo: 1, reviewStatus: 'confirmed', confidence: 95 }).execute()

    const q = await review.queue()
    expect(q).toHaveLength(2)
    expect(q[0].confidence).toBe(20) // lowest first = most urgent
    expect(q[0].jobNo).toBe('JOB-R-2')
    expect(q[0].reviewReasons).toContain('conflict: hbl A vs B')
  })

  it('pairs each queued leg with its OWN booking jobNo and POs (no cross-leg bleed when batching)', async () => {
    const { bk: bkA } = await seedProvisional('JOB-RA', 30)
    const { bk: bkB } = await seedProvisional('JOB-RB', 10)
    const poA = await db.insertInto('purchaseOrders').values({ poNumber: 'PO-RA' }).outputAll('inserted').executeTakeFirstOrThrow()
    const poB = await db.insertInto('purchaseOrders').values({ poNumber: 'PO-RB' }).outputAll('inserted').executeTakeFirstOrThrow()
    await db.insertInto('bookingPos').values({ bookingId: bkA.id, poId: poA.id }).execute()
    await db.insertInto('bookingPos').values({ bookingId: bkB.id, poId: poB.id }).execute()

    const q = await review.queue()
    const posByJob = Object.fromEntries(q.map((r) => [r.jobNo, r.pos]))
    expect(posByJob['JOB-RA']).toEqual(['PO-RA'])
    expect(posByJob['JOB-RB']).toEqual(['PO-RB'])
  })

  it('confirm flips to confirmed and records the reviewer + a manual audit', async () => {
    const { leg } = await seedProvisional('JOB-R-1', 40)
    const res = await review.confirm(leg.id, reviewerId)
    expect(res.reviewStatus).toBe('confirmed')

    const updated = await db.selectFrom('shipments').where('id', '=', leg.id).selectAll().executeTakeFirstOrThrow()
    expect(updated.reviewStatus).toBe('confirmed')
    expect(updated.reviewedBy).toBe(reviewerId)
    expect(updated.reviewedAt).not.toBeNull()

    const audit = await db.selectFrom('changeLog').where('entityId', '=', leg.id).selectAll().execute()
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

    const updated = await db.selectFrom('shipments').where('id', '=', leg.id).selectAll().executeTakeFirstOrThrow()
    expect(updated.reviewStatus).toBe('confirmed')
    expect(updated.soNo).toBe('FIXED-SO')
    expect(updated.eta?.toISOString().slice(0, 10)).toBe('2026-06-01')

    const locks = await db.selectFrom('fieldLocks').where('entityId', '=', leg.id).selectAll().execute()
    expect(locks.map((l) => l.field)).toEqual(expect.arrayContaining(['eta', 'soNo']))
    expect(locks.find((l) => l.field === 'soNo')?.lockedBy).toBe(reviewerId)

    const audit = await db.selectFrom('changeLog').where('entityId', '=', leg.id).selectAll().execute()
    expect(audit.some((a) => a.note === 'forwarder confirmed' && a.field === 'soNo')).toBe(true)
  })

  it('the threshold setting persists (admin config)', async () => {
    await settings.setConfidenceThreshold(70, reviewerId)
    expect(await settings.confidenceThreshold()).toBe(70)
  })
})
