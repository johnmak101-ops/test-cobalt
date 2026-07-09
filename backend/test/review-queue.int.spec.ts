import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
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
  review = new ReviewQueueService(new ReviewEmailRepository(db), shipments, r.masters)
})
afterAll(closeTestDb)
beforeEach(async () => {
  await resetDb(db)
  const u = await db
    .insertInto('users')
    .values({ email: 'r@cobalt.hk', name: 'Reviewer', passwordHash: 'x', role: 'EDITOR' })
    .outputAll('inserted')
    .executeTakeFirstOrThrow()
  actorId = u.id
})

async function seedLegWithReviewEmail() {
  const bk = await db.insertInto('bookings').values({ jobNo: 'JOB-RQ-1' }).outputAll('inserted').executeTakeFirstOrThrow()
  const leg = await db
    .insertInto('shipments')
    .values({ bookingId: bk.id, legNo: 1, bookingNo: 'OLD-BK' })
    .outputAll('inserted')
    .executeTakeFirstOrThrow()
  const re = await db
    .insertInto('reviewEmail')
    .values({ shipmentId: leg.id, extractedData: JSON.stringify({ booking_no: 'OLD-BK' }), reviewStatus: 'NEEDS_REVIEW' })
    .outputAll('inserted')
    .executeTakeFirstOrThrow()
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
    const [updated] = await db.selectFrom('shipments').where('id', '=', leg.id).selectAll().execute()
    expect(updated.bookingNo).toBe('FIXED-BK')
    expect(updated.soNo).toBe('FIXED-SO')

    // human-wins: locked so the agent can never re-clobber the human's value
    const locks = await db.selectFrom('fieldLocks').where('entityId', '=', leg.id).selectAll().execute()
    expect(locks.map((l) => l.field).sort()).toEqual(['bookingNo', 'soNo'])

    // the review row is recorded as corrected, snapshotting the pre-correction extraction
    const [row] = await db.selectFrom('reviewEmail').where('id', '=', re.id).selectAll().execute()
    expect(row.reviewStatus).toBe('REVIEWED_CORRECTED')
    expect((row.extractedData as Record<string, unknown>).booking_no).toBe('FIXED-BK')

    // the reviewer's note rides the audit (the agent-soul iteration signal)
    const audit = await db.selectFrom('changeLog').where('entityId', '=', leg.id).selectAll().execute()
    expect(audit.find((a) => a.field === 'bookingNo')?.note).toBe('booking# was truncated in the reply')
  })

  it('an UNMATCHED email (no shipmentId) records the correction without touching any shipment', async () => {
    const re = await db
      .insertInto('reviewEmail')
      .values({ shipmentId: null, extractedData: JSON.stringify({ booking_no: 'X' }), reviewStatus: 'NEEDS_REVIEW' })
      .outputAll('inserted')
      .executeTakeFirstOrThrow()
    const res = await review.review(re.id, { action: 'correct', corrections: { extractedData: { booking_no: 'X2' } } }, actorId)
    expect(res?.reviewStatus).toBe('REVIEWED_CORRECTED')
    // nothing to apply onto → no human-wins edit happened anywhere
    const manualAudit = await db.selectFrom('changeLog').where('sourceType', '=', 'manual').selectAll().execute()
    expect(manualAudit).toHaveLength(0)
  })

  it('reject / approve do not apply anything back (only correct does)', async () => {
    const { leg, re } = await seedLegWithReviewEmail()
    await review.review(re.id, { action: 'reject' }, actorId)
    const [row] = await db.selectFrom('shipments').where('id', '=', leg.id).selectAll().execute()
    expect(row.bookingNo).toBe('OLD-BK') // untouched
    const locks = await db.selectFrom('fieldLocks').where('entityId', '=', leg.id).selectAll().execute()
    expect(locks).toHaveLength(0)
  })
})

describe('ReviewQueueService.review — matcher Phase 3: corrections become prior_correction facts', () => {
  it('a raw-name→code customer correction writes a prior_correction fact (and supersedes an older one)', async () => {
    await db.insertInto('customers').values({ code: 'WYSE', name: 'WYSE GROUP', country: null, contactEmail: null }).execute()
    const re = await db
      .insertInto('reviewEmail')
      .values({ shipmentId: null, extractedData: JSON.stringify({ customer_code: 'WYSE TRADING HK LIMITED' }), reviewStatus: 'NEEDS_REVIEW' })
      .outputAll('inserted')
      .executeTakeFirstOrThrow()
    await review.review(re.id, { action: 'correct', corrections: { extractedData: { customer_code: 'WYSE' } } }, actorId)

    const facts = await db.selectFrom('masterResolution').where('kind', '=', 'prior_correction').selectAll().execute()
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({ lhs: 'WYSE TRADING HK LIMITED', rhs: 'WYSE', active: true })

    // a second correction of the SAME raw name to a different code supersedes the first (latest wins)
    await db.insertInto('customers').values({ code: 'WYSEL', name: 'WYSE LOGISTICS', country: null, contactEmail: null }).execute()
    const re2 = await db
      .insertInto('reviewEmail')
      .values({ shipmentId: null, extractedData: JSON.stringify({ customer_code: 'WYSE TRADING HK LIMITED' }), reviewStatus: 'NEEDS_REVIEW' })
      .outputAll('inserted')
      .executeTakeFirstOrThrow()
    await review.review(re2.id, { action: 'correct', corrections: { extractedData: { customer_code: 'WYSEL' } } }, actorId)
    const after = await db.selectFrom('masterResolution').where('kind', '=', 'prior_correction').where('active', '=', true).selectAll().execute()
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ lhs: 'WYSE TRADING HK LIMITED', rhs: 'WYSEL' })
  })

  it('does NOT write a fact for code→code edits', async () => {
    await db.insertInto('customers').values({ code: 'COLE', name: 'COLE BUYING', country: null, contactEmail: null }).execute()
    await db.insertInto('customers').values({ code: 'WYSE', name: 'WYSE GROUP', country: null, contactEmail: null }).execute()
    // old value is ALREADY a master code → not a raw-name correction, nothing recorded
    const re = await db
      .insertInto('reviewEmail')
      .values({ shipmentId: null, extractedData: JSON.stringify({ customer_code: 'COLE' }), reviewStatus: 'NEEDS_REVIEW' })
      .outputAll('inserted')
      .executeTakeFirstOrThrow()
    await review.review(re.id, { action: 'correct', corrections: { extractedData: { customer_code: 'WYSE' } } }, actorId)
    expect(await db.selectFrom('masterResolution').where('kind', '=', 'prior_correction').selectAll().execute()).toHaveLength(0)
  })
})
