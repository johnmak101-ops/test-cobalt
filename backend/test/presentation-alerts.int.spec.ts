import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import * as schema from '../src/db/contracts'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import { EmailRepository } from '../src/db/repositories/email.repository'
import { PresentationService } from '../src/presentation/presentation.service'

let db: TestDB
let presentation: PresentationService

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  const r = repos(db)
  presentation = new PresentationService(r.shipment, r.booking, r.masters, r.alert, r.audit, new EmailRepository(db), r.evidence)
})
afterAll(closeTestDb)
beforeEach(() => resetDb(db))

/** Seed a booking+leg+PO and fire an ACTIVE alert on that leg. Returns the leg. */
async function seedAlertedShipment(jobNo: string, poNumber: string, customerId: string) {
  const [bk] = await db.insert(schema.bookings).values({ jobNo, customerId }).returning()
  const [leg] = await db.insert(schema.shipments).values({ bookingId: bk.id, legNo: 1 }).returning()
  const [po] = await db.insert(schema.purchaseOrders).values({ poNumber }).returning()
  await db.insert(schema.bookingPos).values({ bookingId: bk.id, poId: po.id })
  await db.insert(schema.alertInstances).values({ ruleId: 'R1', shipmentId: leg.id, severity: 'WARNING', message: `alert ${jobNo}` })
  return leg
}

describe('PresentationService.alerts (integration) — per-alert shipment summaries', () => {
  beforeEach(async () => {
    // alert_instances.rule_id is a NOT NULL FK → alert_rules.id
    await db.insert(schema.alertRules).values({
      id: 'R1', name: 'test rule', description: 'd', triggerType: 'days_after',
      triggerReference: 'booking_request', watchFor: 'so', thresholdHours: 0, severity: 'WARNING',
    })
  })

  it('nests each alert’s OWN shipment summary (id + POs + customer), no cross-alert bleed', async () => {
    const [cust] = await db.insert(schema.customers).values({ code: 'COLE', name: 'Cole Haan' }).returning()
    const legA = await seedAlertedShipment('JOB-AA', 'PO-AA', cust.id)
    const legB = await seedAlertedShipment('JOB-BB', 'PO-BB', cust.id)

    const { alerts: out } = await presentation.alerts()
    expect(out).toHaveLength(2)
    const byShipment = Object.fromEntries(out.map((a) => [a.shipment?.id, a.shipment]))
    expect(byShipment[legA.id]).toMatchObject({ id: legA.id, poNumbers: '["PO-AA"]', customer: { name: 'Cole Haan' } })
    expect(byShipment[legB.id]).toMatchObject({ id: legB.id, poNumbers: '["PO-BB"]', customer: { name: 'Cole Haan' } })
  })

  it('leaves shipment null when an alert carries no shipmentId', async () => {
    await db.insert(schema.alertInstances).values({ ruleId: 'R1', shipmentId: null, severity: 'WARNING', message: 'orphan' })
    const { alerts: out } = await presentation.alerts()
    expect(out).toHaveLength(1)
    expect(out[0].shipment).toBeNull()
  })
})
