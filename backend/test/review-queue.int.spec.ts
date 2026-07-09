import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '../src/db/contracts'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import { ShipmentsService } from '../src/shipments/shipments.service'
import { ReviewQueueService } from '../src/emails/review-queue.service'
import { ReviewEmailRepository } from '../src/db/repositories/review-email.repository'

let db: TestDB
let review: ReviewQueueService
let actorId: string

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  const r = repos(db)
  // editFields/applyExtractionCorrection don't touch the committer (only createManual does), so omit it —
  // same construction the shipment-edit spec uses.
  const shipments = new ShipmentsService(r.shipment, r.booking, r.fieldLock, r.audit)
  review = new ReviewQueueService(new ReviewEmailRepository(db), shipments)
})
afterAll(closeTestDb)
beforeEach(async () => {
  await resetDb(db)
  const [u] = await db
    .insert(schema.users)
    .values({ email: 'r@cobalt.hk', name: 'Reviewer', passwordHash: 'x', role: 'EDITOR' })
    .returning()
  actorId = u.id
})

async function seedLegWithReviewEmail() {
  const [bk] = await db.insert(schema.bookings).values({ jobNo: 'JOB-RQ-1' }).returning()
  const [leg] = await db.insert(schema.shipments).values({ bookingId: bk.id, legNo: 1, bookingNo: 'OLD-BK' }).returning()
  const [re] = await db
    .insert(schema.reviewEmail)
    .values({ shipmentId: leg.id, extractedData: { booking_no: 'OLD-BK' }, reviewStatus: 'NEEDS_REVIEW' })
    .returning()
  return { leg, re }
}

describe('ReviewQueueService.review — a correct verdict applies back to the shipment', () => {
  it('re-applies the corrected fields to the linked shipment (write + human-wins lock + audit + review row)', async () => {
    const { leg, re } = await seedLegWithReviewEmail()
    await review.review(
      re.id,
      { action: 'correct', corrections: { extractedData: { booking_no: 'FIXED-BK', so_no: 'FIXED-SO' } }, notes: 'booking# was truncated in the reply' },
      actorId,
    )

    // the correction reached TRACKING (not just the review row)
    const [updated] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, leg.id))
    expect(updated.bookingNo).toBe('FIXED-BK')
    expect(updated.soNo).toBe('FIXED-SO')

    // human-wins: locked so the agent can never re-clobber the human's value
    const locks = await db.select().from(schema.fieldLocks).where(eq(schema.fieldLocks.entityId, leg.id))
    expect(locks.map((l) => l.field).sort()).toEqual(['bookingNo', 'soNo'])

    // the review row is recorded as corrected, snapshotting the pre-correction extraction
    const [row] = await db.select().from(schema.reviewEmail).where(eq(schema.reviewEmail.id, re.id))
    expect(row.reviewStatus).toBe('REVIEWED_CORRECTED')
    expect((row.extractedData as Record<string, unknown>).booking_no).toBe('FIXED-BK')

    // the reviewer's note rides the audit (the agent-soul iteration signal)
    const audit = await db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, leg.id))
    expect(audit.find((a) => a.field === 'bookingNo')?.note).toBe('booking# was truncated in the reply')
  })

  it('an UNMATCHED email (no shipmentId) records the correction without touching any shipment', async () => {
    const [re] = await db
      .insert(schema.reviewEmail)
      .values({ shipmentId: null, extractedData: { booking_no: 'X' }, reviewStatus: 'NEEDS_REVIEW' })
      .returning()
    const res = await review.review(re.id, { action: 'correct', corrections: { extractedData: { booking_no: 'X2' } } }, actorId)
    expect(res?.reviewStatus).toBe('REVIEWED_CORRECTED')
    // nothing to apply onto → no human-wins edit happened anywhere
    const manualAudit = await db.select().from(schema.changeLog).where(eq(schema.changeLog.sourceType, 'manual'))
    expect(manualAudit).toHaveLength(0)
  })

  it('reject / approve do not apply anything back (only correct does)', async () => {
    const { leg, re } = await seedLegWithReviewEmail()
    await review.review(re.id, { action: 'reject' }, actorId)
    const [row] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, leg.id))
    expect(row.bookingNo).toBe('OLD-BK') // untouched
    const locks = await db.select().from(schema.fieldLocks).where(eq(schema.fieldLocks.entityId, leg.id))
    expect(locks).toHaveLength(0)
  })
})
