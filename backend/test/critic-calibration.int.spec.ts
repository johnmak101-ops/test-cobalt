import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import type { Insertable } from 'kysely'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import type { DB } from '../src/db/kysely/db'
import { ReviewService } from '../src/review/review.service'
import { QueueLearningClient } from '../src/review/queue-learning.client'
import {
  CriticCalibrationRepository,
  CALIBRATION_RETENTION_DAYS,
} from '../src/db/repositories/critic-calibration.repository'
import { aggregateCriticCalibration } from '../src/settings/critic-calibration-report'
import type { CriticReview } from '../src/decisions/critic-review.types'

let db: TestDB
let review: ReviewService
let calibration: CriticCalibrationRepository
let reviewerId: string

const criticHigh: CriticReview = {
  confidence: { score: 92, band: 'high', label: 'High' },
  summary: 'Clean',
  observations: [],
  priorState: { headline: 'New', fields: [] },
  proposedChanges: [],
  riskFlags: [],
  recommendedHumanAction: 'approve_ok',
  reasons: [],
}

const criticLow: CriticReview = {
  ...criticHigh,
  confidence: { score: 20, band: 'low', label: 'Low' },
  summary: 'Weak',
  recommendedHumanAction: 'review',
}

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  const r = repos(db)
  // QueueLearningClient no-ops when QUEUE_API_BASE is unset (standalone tracking).
  review = new ReviewService(
    r.shipment,
    r.booking,
    r.fieldLock,
    r.audit,
    new QueueLearningClient({ get: (k: string) => process.env[k] } as any),
    r.criticCalibration,
    r.masters,
    r.priorCorrections,
  )
  calibration = r.criticCalibration
})
afterAll(closeTestDb)
beforeEach(async () => {
  await resetDb(db)
  const u = await db
    .insertInto('users')
    .values({ email: 'cal@test.local', name: 'Cal', passwordHash: 'x', role: 'EDITOR' })
    .outputAll('inserted')
    .executeTakeFirstOrThrow()
  reviewerId = u.id
})

async function seedProvisional(
  jobNo: string,
  over: Partial<Insertable<DB['shipments']>> = {},
) {
  const bk = await db.insertInto('bookings').values({ jobNo }).outputAll('inserted').executeTakeFirstOrThrow()
  const leg = await db
    .insertInto('shipments')
    .values({
      bookingId: bk.id,
      legNo: 1,
      reviewStatus: 'provisional',
      confidence: 40,
      reviewReasons: JSON.stringify(['needs review']),
      ...over,
    })
    .outputAll('inserted')
    .executeTakeFirstOrThrow()
  return { bk, leg }
}

describe('critic calibration (integration)', () => {
  it('confirm writes approved with band snapshot; later critic_review change does not mutate row', async () => {
    const { leg } = await seedProvisional('JOB-CAL-1', {
      criticReview: JSON.stringify(criticHigh),
    })

    await review.confirm(leg.id, reviewerId)

    const rows = await db
      .selectFrom('criticCalibration')
      .where('shipmentId', '=', leg.id)
      .selectAll()
      .execute()
    expect(rows).toHaveLength(1)
    expect(rows[0].band).toBe('high')
    expect(rows[0].outcome).toBe('approved')
    expect(rows[0].correctedFieldCount).toBe(0)
    expect(rows[0].actorId).toBe(reviewerId)

    // Mutate live critic_review after confirm — calibration row must stay snapshotted.
    await db
      .updateTable('shipments')
      .set({ criticReview: JSON.stringify(criticLow) })
      .where('id', '=', leg.id)
      .execute()

    const [again] = await db
      .selectFrom('criticCalibration')
      .where('shipmentId', '=', leg.id)
      .selectAll()
      .execute()
    expect(again.band).toBe('high')
    expect(again.outcome).toBe('approved')
  })

  it('correct writes corrected + field count', async () => {
    const { leg } = await seedProvisional('JOB-CAL-2', {
      criticReview: JSON.stringify(criticHigh),
      soNo: 'SO-OLD',
    })

    const res = await review.correct(
      leg.id,
      { fields: { soNo: 'SO-FIXED', bookingNo: 'BK-FIXED' }, reason: 'forwarder confirmed' },
      reviewerId,
    )
    expect(res.corrected).toHaveLength(2)

    const [row] = await db
      .selectFrom('criticCalibration')
      .where('shipmentId', '=', leg.id)
      .selectAll()
      .execute()
    expect(row.outcome).toBe('corrected')
    expect(row.band).toBe('high')
    expect(row.correctedFieldCount).toBe(2)
    expect(row.actorId).toBe(reviewerId)
  })

  it('dismiss writes dismissed', async () => {
    const { leg } = await seedProvisional('JOB-CAL-3', {
      criticReview: JSON.stringify({
        ...criticHigh,
        confidence: { score: 55, band: 'medium', label: 'Medium' },
      }),
    })

    const res = await review.dismiss([leg.id], reviewerId, 'portal noise')
    expect(res).toEqual({ dismissed: 1 })

    const [row] = await db
      .selectFrom('criticCalibration')
      .where('shipmentId', '=', leg.id)
      .selectAll()
      .execute()
    expect(row.outcome).toBe('dismissed')
    expect(row.band).toBe('medium')
    expect(row.correctedFieldCount).toBe(0)
  })

  it('legacy null band when provisional has no criticReview', async () => {
    const { leg } = await seedProvisional('JOB-CAL-4')
    // no criticReview column set

    await review.confirm(leg.id, reviewerId)

    const [row] = await db
      .selectFrom('criticCalibration')
      .where('shipmentId', '=', leg.id)
      .selectAll()
      .execute()
    expect(row.band).toBeNull()
    expect(row.outcome).toBe('approved')
  })

  it('pruneOlderThan drops old rows', async () => {
    await calibration.insert({
      shipmentId: null,
      band: 'high',
      outcome: 'approved',
      correctedFieldCount: 0,
      actorId: null,
      reasons: null,
    })

    const before = await db.selectFrom('criticCalibration').selectAll().execute()
    expect(before).toHaveLength(1)

    // Backdate past retention window so prune removes it.
    const daysAgo = CALIBRATION_RETENTION_DAYS + 1
    await db
      .updateTable('criticCalibration')
      .set({ decidedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000) })
      .execute()

    await calibration.pruneOlderThan(CALIBRATION_RETENTION_DAYS)

    const after = await db.selectFrom('criticCalibration').selectAll().execute()
    expect(after).toHaveLength(0)
  })

  it('report aggregation over real rows', async () => {
    // high: 1 approved + 1 corrected → highBandCorrectionRate = 0.5
    // low: 1 approved → contributes to lowMediumApprovedRate
    await calibration.insert({
      shipmentId: null,
      band: 'high',
      outcome: 'approved',
      correctedFieldCount: 0,
      actorId: reviewerId,
      reasons: null,
    })
    await calibration.insert({
      shipmentId: null,
      band: 'high',
      outcome: 'corrected',
      correctedFieldCount: 1,
      actorId: reviewerId,
      reasons: ['wrong so'],
    })
    await calibration.insert({
      shipmentId: null,
      band: 'low',
      outcome: 'approved',
      correctedFieldCount: 0,
      actorId: reviewerId,
      reasons: null,
    })

    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    const rows = await calibration.listSince(since)
    expect(rows.length).toBeGreaterThanOrEqual(3)

    const report = aggregateCriticCalibration(
      rows.map((r) => ({
        shipmentId: r.shipmentId,
        decidedAt: r.decidedAt,
        band: r.band,
        outcome: r.outcome,
        correctedFieldCount: r.correctedFieldCount,
        actorId: r.actorId,
      })),
      90,
    )

    expect(report.total).toBe(3)
    expect(report.byBand.high.total).toBe(2)
    expect(report.byBand.high.corrected).toBe(1)
    expect(report.byBand.high.approved).toBe(1)
    expect(report.highBandCorrectionRate).toBe(0.5)
    expect(report.byBand.low.total).toBe(1)
    expect(report.lowMediumApprovedRate).toBe(1)
    // high-band corrected sample surfaces first
    expect(report.samples[0].band).toBe('high')
    expect(report.samples[0].outcome).toBe('corrected')
  })

  it('countSince returns the TRUE window count (so a capped read reports truncated)', async () => {
    const cal = repos(db).criticCalibration
    for (let i = 0; i < 3; i++) {
      await cal.insert({
        shipmentId: null, band: 'high', outcome: 'approved',
        correctedFieldCount: 0, actorId: null, reasons: null,
      })
    }
    const since = new Date(Date.now() - 90 * 86400000)
    expect(await cal.countSince(since)).toBe(3)

    // A capped read analyses fewer rows than the window holds → the report must say so.
    const capped = await cal.listSince(since, 1)
    expect(capped).toHaveLength(1)
    const report = aggregateCriticCalibration(
      capped.map((r) => ({
        shipmentId: r.shipmentId, decidedAt: r.decidedAt, band: r.band,
        outcome: r.outcome, correctedFieldCount: r.correctedFieldCount, actorId: r.actorId,
      })),
      90,
      await cal.countSince(since),
    )
    expect(report.total).toBe(1)
    expect(report.windowTotal).toBe(3)
    expect(report.truncated).toBe(true)
  })
})
