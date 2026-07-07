import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import * as schema from '../src/db/contracts'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import { AlertEvaluatorService } from '../src/alerts/alert-evaluator.service'

let db: TestDB
let evaluator: AlertEvaluatorService

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  const r = repos(db)
  evaluator = new AlertEvaluatorService(r.alert, r.shipment)
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
async function seedLeg(over: Partial<typeof schema.shipments.$inferInsert> = {}) {
  const [bk] = await db.insert(schema.bookings).values({ jobNo: 'JOB-T-1' }).returning()
  const [leg] = await db
    .insert(schema.shipments)
    .values({ bookingId: bk.id, legNo: 1, state: 'CONFIRMED', legStatus: 'ACTIVE', ...over })
    .returning()
  return { bk, leg }
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
})
