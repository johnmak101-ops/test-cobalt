import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '../src/db/contracts'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import { AlertEvaluatorService } from '../src/alerts/alert-evaluator.service'
import { EmailRepository } from '../src/db/repositories/email.repository'

let db: TestDB
let evaluator: AlertEvaluatorService

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  const r = repos(db)
  evaluator = new AlertEvaluatorService(r.alert, r.shipment, new EmailRepository(db), r.evidence)
})
afterAll(closeTestDb)
beforeEach(() => resetDb(db))

async function seedA3() {
  await db.insert(schema.alertRules).values({
    id: 'A3',
    name: 'Cut-off passed, no Final B/L',
    description: 'Cut-off passed without Final B/L',
    state: 'CONFIRMED',
    triggerType: 'days_after',
    triggerReference: 'cutoff',
    watchFor: 'final_bl',
    thresholdHours: 0,
    severity: 'CRITICAL',
    computeTz: 'vessel',
    locked: true,
  })
}
async function seedLeg(over: Partial<typeof schema.shipments.$inferInsert> = {}, jobNo = 'JOB-T-1') {
  const [bk] = await db.insert(schema.bookings).values({ jobNo }).returning()
  const [leg] = await db
    .insert(schema.shipments)
    .values({ bookingId: bk.id, legNo: 1, state: 'CONFIRMED', legStatus: 'ACTIVE', ...over })
    .returning()
  return { bk, leg }
}

/** Seed an ingested email + its parsed cargo_ready_date + a shipment_emails link (the A7 evidence path). */
async function seedEvidenceEmail(shipmentId: string, graphId: string, receivedAt: string, crd: string) {
  const [em] = await db.insert(schema.ingestEmailMessage).values({ graphMessageId: graphId, receivedAt: new Date(receivedAt) }).returning()
  await db.insert(schema.ingestParsedRecord).values({ messageId: em.id, recordIdx: 0, fields: { cargo_ready_date: crd }, matchKeys: {} })
  await db.insert(schema.shipmentEmails).values({ shipmentId, graphMessageId: graphId, emailType: 'Other', receivedAt: new Date(receivedAt) })
}

describe('AlertEvaluatorService (integration)', () => {
  it('fires A3 (Critical) when cut-off passed + no Final B/L, and dedups on re-run', async () => {
    await seedA3()
    await seedLeg({ cfsCutoff: new Date('2026-02-01') })

    const r1 = await evaluator.evaluate(new Date('2026-02-05'))
    expect(r1.fired).toBe(1)
    const alerts = await db.select().from(schema.alertInstances)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].severity).toBe('CRITICAL')
    expect(alerts[0].ruleId).toBe('A3')

    const r2 = await evaluator.evaluate(new Date('2026-02-06'))
    expect(r2.fired).toBe(0) // deduped
    expect(await db.select().from(schema.alertInstances)).toHaveLength(1)
  })

  it('fires A3 off warehouse_end_date when cfs_cutoff is unset (parser vocab: CFS cut-off ≡ 截倉 ≡ warehouse end)', async () => {
    // The parser never emits cfs_cutoff — it fills warehouse_end_date for 截倉时间 (soul field 12); the
    // cfs_cutoff column only fills from a human edit. So a cutoff-anchored alert must see warehouse_end_date.
    await seedA3()
    await seedLeg({ cfsCutoff: null, warehouseEndDate: new Date('2026-02-01') })
    const r = await evaluator.evaluate(new Date('2026-02-05'))
    expect(r.fired).toBe(1)
    const alerts = await db.select().from(schema.alertInstances)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].ruleId).toBe('A3')
  })

  it('skips provisional (low-confidence) legs — commit-first never alerts on unreviewed data', async () => {
    await seedA3()
    await seedLeg({ cfsCutoff: new Date('2026-02-01'), reviewStatus: 'provisional' })
    const r = await evaluator.evaluate(new Date('2026-02-05'))
    expect(r.fired).toBe(0)
    expect(await db.select().from(schema.alertInstances)).toHaveLength(0)
  })

  it('does NOT fire A3 once a Final B/L milestone exists', async () => {
    await seedA3()
    const { leg } = await seedLeg({ cfsCutoff: new Date('2026-02-01') })
    await db
      .insert(schema.shipmentMilestones)
      .values({ shipmentId: leg.id, milestoneType: 'FINAL_BL_RECEIVED', occurredAt: new Date('2026-02-03') })

    const r = await evaluator.evaluate(new Date('2026-02-05'))
    expect(r.fired).toBe(0)
    expect(await db.select().from(schema.alertInstances)).toHaveLength(0)
  })

  it('fires A7 only for the leg whose evidence requested a later CRD than the newest doc reflects (per-leg isolation)', async () => {
    // leg A: newest booking doc (2026-03-10) still shows 2026-03-01, but an earlier email requested 2026-03-20
    const { leg: legA } = await seedLeg({ cargoReadyDate: new Date('2026-03-01') }, 'JOB-A7-A')
    await seedEvidenceEmail(legA.id, 'gA1', '2026-03-10T00:00:00Z', '2026-03-01')
    await seedEvidenceEmail(legA.id, 'gA2', '2026-03-09T00:00:00Z', '2026-03-20')
    // leg B: two emails but both agree with the tracked CRD → no revision requested → no A7
    const { leg: legB } = await seedLeg({ cargoReadyDate: new Date('2026-04-01') }, 'JOB-A7-B')
    await seedEvidenceEmail(legB.id, 'gB1', '2026-04-10T00:00:00Z', '2026-04-01')
    await seedEvidenceEmail(legB.id, 'gB2', '2026-04-09T00:00:00Z', '2026-04-01')

    const r = await evaluator.evaluate(new Date('2026-04-15'))
    expect(r.fired).toBe(1)
    const a7 = await db.select().from(schema.alertInstances).where(eq(schema.alertInstances.ruleId, 'A7'))
    expect(a7).toHaveLength(1)
    expect(a7[0].shipmentId).toBe(legA.id)
    expect(a7[0].message).toContain('2026-03-20')
  })
})
