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
  const envConfig = { get: (k: string) => process.env[k] } as any
  review = new ReviewService(r.shipment, r.booking, r.fieldLock, r.audit, new QueueLearningClient(envConfig), r.criticCalibration, r.masters, r.priorCorrections)
  settings = new SettingsService(r.settings, r.routingShadow, r.criticCalibration)
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

  it('confirm flips to confirmed and records the reviewer + a review-sourced audit', async () => {
    const { leg } = await seedProvisional('JOB-R-1', 40)
    const res = await review.confirm(leg.id, reviewerId)
    expect(res.reviewStatus).toBe('confirmed')

    const updated = await db.selectFrom('shipments').where('id', '=', leg.id).selectAll().executeTakeFirstOrThrow()
    expect(updated.reviewStatus).toBe('confirmed')
    expect(updated.reviewedBy).toBe(reviewerId)
    expect(updated.reviewedAt).not.toBeNull()

    const audit = await db.selectFrom('changeLog').where('entityId', '=', leg.id).selectAll().execute()
    // 'review' distinguishes a queue decision from an Order Details edit ('manual'). Hitting the
    // real DB here also proves migration 0020 widened ck_change_log_source_type — the INSERT would
    // fail the CHECK otherwise.
    expect(audit.some((a) => a.sourceType === 'review' && a.actorUserId === reviewerId)).toBe(true)
  })

  it('correct updates a field, records a lock on it, audits the reason, and confirms', async () => {
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

  describe('dismiss / restore (#133)', () => {
    function spyLearning() {
      const posts: unknown[] = []
      const client = { postCorrection: async (p: unknown) => { posts.push(p) } } as unknown as QueueLearningClient
      return { posts, client }
    }
    function svcWith(client: QueueLearningClient) {
      const r = repos(db)
      return new ReviewService(r.shipment, r.booking, r.fieldLock, r.audit, client, r.criticCalibration, r.masters, r.priorCorrections)
    }

    it('dismiss stamps dismissed_at + reviewer, audits, drops from queue(), and posts NO learning signals', async () => {
      const { leg } = await seedProvisional('JOB-D-1', 30)
      const { posts, client } = spyLearning()
      const svc = svcWith(client)

      const res = await svc.dismiss([leg.id], reviewerId, 'portal echo — no carrier move')
      expect(res).toEqual({ dismissed: 1 })

      const updated = await db.selectFrom('shipments').where('id', '=', leg.id).selectAll().executeTakeFirstOrThrow()
      expect(updated.dismissedAt).not.toBeNull()
      expect(updated.reviewStatus).toBe('provisional') // NEVER confirmed — stays out of alerts/automation
      expect(updated.reviewedBy).toBe(reviewerId)
      expect(updated.reviewedAt).not.toBeNull()

      expect((await svc.queue()).find((q) => q.id === leg.id)).toBeUndefined()

      const audit = await db.selectFrom('changeLog').where('entityId', '=', leg.id).selectAll().execute()
      expect(audit.some((a) => a.newValue === 'dismissed' && /portal echo/.test(a.note ?? ''))).toBe(true)
      expect(posts).toHaveLength(0) // dismissal teaches nothing — approving noise would poison the feed
    })

    it('dismiss skips confirmed / DOCUMENT / already-dismissed / unknown ids but processes the rest', async () => {
      const { leg: ok } = await seedProvisional('JOB-D-2', 30)
      const { leg: confirmed } = await seedProvisional('JOB-D-3', 30, { reviewStatus: 'confirmed' })
      const { leg: doc } = await seedProvisional('JOB-D-4', 30, { kind: 'DOCUMENT' })
      const { leg: gone } = await seedProvisional('JOB-D-5', 30, { dismissedAt: new Date('2026-07-01T00:00:00Z') })
      const svc = svcWith(spyLearning().client)

      const res = await svc.dismiss(
        [ok.id, confirmed.id, doc.id, gone.id, '00000000-0000-0000-0000-000000000000'],
        reviewerId,
      )
      expect(res).toEqual({ dismissed: 1 })

      const rows = await db.selectFrom('shipments').where('id', 'in', [ok.id, confirmed.id]).selectAll().execute()
      expect(rows.find((r) => r.id === ok.id)?.dismissedAt).not.toBeNull()
      expect(rows.find((r) => r.id === confirmed.id)?.dismissedAt).toBeNull()
    })

    it('restore clears dismissed_at, audits, and the leg returns to queue()', async () => {
      const { leg } = await seedProvisional('JOB-D-6', 30)
      const svc = svcWith(spyLearning().client)
      await svc.dismiss([leg.id], reviewerId)

      const res = await svc.restore(leg.id, reviewerId)
      expect(res).toEqual({ shipmentId: leg.id, restored: true })

      const updated = await db.selectFrom('shipments').where('id', '=', leg.id).selectAll().executeTakeFirstOrThrow()
      expect(updated.dismissedAt).toBeNull()
      expect((await svc.queue()).find((q) => q.id === leg.id)).toBeTruthy()

      const audit = await db.selectFrom('changeLog').where('entityId', '=', leg.id).selectAll().execute()
      expect(audit.some((a) => a.note === 'review: restored to queue')).toBe(true)

      // restoring a non-dismissed leg is a no-op
      expect(await svc.restore(leg.id, reviewerId)).toEqual({ shipmentId: leg.id, restored: false })
    })
  })
})
