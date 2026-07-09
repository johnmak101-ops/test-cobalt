import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
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

/** Seed a booking+leg+PO and fire an ACTIVE alert on that leg. Returns the leg.
 *  dedupKey is set per alert (as insertDeduped always does) — SQL Server's UNIQUE (dedup_key)
 *  treats NULLs as equal, so two NULL-keyed seed alerts would collide. */
async function seedAlertedShipment(jobNo: string, poNumber: string, customerId: string) {
  const bk = await db.insertInto('bookings').values({ jobNo, customerId }).outputAll('inserted').executeTakeFirstOrThrow()
  const leg = await db.insertInto('shipments').values({ bookingId: bk.id, legNo: 1 }).outputAll('inserted').executeTakeFirstOrThrow()
  const po = await db.insertInto('purchaseOrders').values({ poNumber }).outputAll('inserted').executeTakeFirstOrThrow()
  await db.insertInto('bookingPos').values({ bookingId: bk.id, poId: po.id }).execute()
  await db
    .insertInto('alerts')
    .values({ ruleId: 'R1', shipmentId: leg.id, severity: 'WARNING', message: `alert ${jobNo}`, dedupKey: `R1:${jobNo}` })
    .execute()
  return leg
}

describe('PresentationService.alerts (integration) — per-alert shipment summaries', () => {
  beforeEach(async () => {
    // alerts.rule_id is a NOT NULL FK → alert_rules.id
    await db
      .insertInto('alertRules')
      .values({
        id: 'R1', name: 'test rule', description: 'd', triggerType: 'days_after',
        triggerReference: 'booking_request', watchFor: 'so', thresholdHours: 0, severity: 'WARNING',
      })
      .execute()
  })

  it('nests each alert’s OWN shipment summary (id + POs + customer), no cross-alert bleed', async () => {
    const cust = await db.insertInto('customers').values({ code: 'COLE', name: 'Cole Haan' }).outputAll('inserted').executeTakeFirstOrThrow()
    const legA = await seedAlertedShipment('JOB-AA', 'PO-AA', cust.id)
    const legB = await seedAlertedShipment('JOB-BB', 'PO-BB', cust.id)

    const { alerts: out } = await presentation.alerts()
    expect(out).toHaveLength(2)
    const byShipment = Object.fromEntries(out.map((a) => [a.shipment?.id, a.shipment]))
    expect(byShipment[legA.id]).toMatchObject({ id: legA.id, poNumbers: '["PO-AA"]', customer: { name: 'Cole Haan' } })
    expect(byShipment[legB.id]).toMatchObject({ id: legB.id, poNumbers: '["PO-BB"]', customer: { name: 'Cole Haan' } })
  })

  it('leaves shipment null when an alert carries no shipmentId', async () => {
    await db.insertInto('alerts').values({ ruleId: 'R1', shipmentId: null, severity: 'WARNING', message: 'orphan' }).execute()
    const { alerts: out } = await presentation.alerts()
    expect(out).toHaveLength(1)
    expect(out[0].shipment).toBeNull()
  })
})
