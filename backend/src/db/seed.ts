/**
 * Seed the tracking + alerts schemas with masters, a fixture PO mirror, the A1-A6 Pillar-4
 * rules, and one demo booking (PO 100-100209, New Lobster / Torque) re-planned sea -> air so
 * the read endpoints return a real two-leg booking. Idempotent: truncates first.
 *
 * Run: pnpm --filter backend seed   (uses DATABASE_URL, or the local dev DB by default)
 */
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq, sql } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import * as schema from '@cobalt/contracts'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/cobalt'

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const db = drizzle(pool, { schema })

  await db.execute(sql`truncate table
    tracking.shipment_pos, tracking.shipment_milestones, tracking.shipments,
    tracking.booking_pos, tracking.bookings, tracking.purchase_orders,
    tracking.field_locks, tracking.app_settings, tracking.forwarder_aliases, tracking.consignees,
    tracking.forwarders, tracking.vendors, tracking.customers, tracking.ports,
    tracking.users, tracking.refresh_tokens
    restart identity cascade`)
  await db.execute(sql`truncate table alerts.alerts, alerts.alert_rules restart identity cascade`)

  // ---- masters ----
  const [newlob] = await db.insert(schema.customers).values({ code: 'NEWLOB', name: 'New Lobster (UK)' }).returning()
  await db.insert(schema.customers).values([
    { code: 'SKIM', name: 'SKIM' },
    { code: 'WYSE', name: 'WYSE MACFUN' },
    { code: 'BELSTAFF', name: 'Belstaff' },
  ])

  const [factory] = await db
    .insert(schema.vendors)
    .values({ code: 'ROKNFT', name: 'Roknit Factory', type: 'factory', location: 'Shenzhen' })
    .returning()

  const [torque] = await db.insert(schema.forwarders).values({ code: 'TORQUE', name: 'Torque / Shipair' }).returning()
  const fwd = await db
    .insert(schema.forwarders)
    .values([
      { code: 'GFS', name: 'GFS' },
      { code: 'JAS', name: 'JAS' },
      { code: 'DSV', name: 'DSV' },
      { code: 'LOGWIN', name: 'Logwin' },
      { code: 'APL', name: 'APL Logistics' },
      { code: 'DPWORLD', name: 'DP World' },
      { code: 'SEKO', name: 'SEKO Logistics' },
    ])
    .returning()

  await db.insert(schema.forwarderAliases).values([
    { forwarderId: torque.id, aliasType: 'domain', value: 'torque.example' },
    { forwarderId: torque.id, aliasType: 'name', value: 'Shipair' },
    { forwarderId: fwd[0].id, aliasType: 'name', value: 'Global Freight Solutions' },
  ])

  const ports = await db
    .insert(schema.ports)
    .values([
      { unlocode: 'CNYTN', name: 'Yantian', country: 'CN', mode: 'sea' },
      { unlocode: 'CNSZX', name: 'Shenzhen', country: 'CN', mode: 'sea' },
      { unlocode: 'CNSHA', name: 'Shanghai', country: 'CN', mode: 'sea' },
      { unlocode: 'GBFXT', name: 'Felixstowe', country: 'GB', mode: 'sea' },
      { unlocode: 'NLRTM', name: 'Rotterdam', country: 'NL', mode: 'sea' },
      { unlocode: 'FRLEH', name: 'Le Havre', country: 'FR', mode: 'sea' },
      { unlocode: 'USLAX', name: 'Los Angeles', country: 'US', mode: 'sea' },
      { unlocode: 'HKG', name: 'Hong Kong Intl', country: 'HK', mode: 'air' },
      { unlocode: 'LHR', name: 'London Heathrow', country: 'GB', mode: 'air' },
    ])
    .returning()
  const port = (code: string) => ports.find((p) => p.unlocode === code)

  const [consignee] = await db
    .insert(schema.consignees)
    .values({ name: 'CINQ-HUITIEMES S.A.', address: 'Paris, France', mapsToCustomerId: newlob.id })
    .returning()

  // ---- fixture PO mirror ----
  const [po] = await db
    .insert(schema.purchaseOrders)
    .values({
      poNumber: '100-100209',
      customerId: newlob.id,
      vendorId: factory.id,
      brand: 'New Lobster',
      itemStyleNo: 'KT-771',
      totalQuantity: 5000,
      quantityUnit: 'pieces',
      crd: new Date('2026-02-03T00:00:00Z'),
      erpSyncedAt: new Date(),
    })
    .returning()

  // ---- demo booking with a sea -> air re-plan ----
  const [booking] = await db
    .insert(schema.bookings)
    .values({
      jobNo: 'JOB-2026-0001',
      customerId: newlob.id,
      vendorId: factory.id,
      forwarderId: torque.id,
      consigneeId: consignee.id,
      brand: 'New Lobster',
      crd: new Date('2026-02-03T00:00:00Z'),
    })
    .returning()
  await db.insert(schema.bookingPos).values({ bookingId: booking.id, poId: po.id })

  const mk = { booking_no: '118997', customer_po: '100-100209', conversation_id: 'conv-seed-1' }
  const [leg1] = await db
    .insert(schema.shipments)
    .values({
      bookingId: booking.id, legNo: 1, mode: 'SEA', state: 'CONFIRMED', legStatus: 'SUPERSEDED',
      forwarderId: torque.id, consigneeId: consignee.id, bookingNo: '118997', soNo: 'SESZX_0286_26_RZ',
      vesselName: 'EVER GLOBE', voyageNo: '0114-068E', polId: port('CNYTN')?.id, podId: port('GBFXT')?.id,
      cargoReadyDate: new Date('2026-02-03T00:00:00Z'), etd: new Date('2026-02-10T00:00:00Z'),
      eta: new Date('2026-03-05T00:00:00Z'), qty: 5000, qtyUnit: 'pieces', matchKeys: mk,
    })
    .returning()
  const [leg2] = await db
    .insert(schema.shipments)
    .values({
      bookingId: booking.id, legNo: 2, mode: 'AIR', state: 'BOOKED', legStatus: 'ACTIVE',
      forwarderId: torque.id, consigneeId: consignee.id, flightNo: 'CX251', mawb: '160-12345678',
      polId: port('HKG')?.id, podId: port('LHR')?.id, etd: new Date('2026-02-12T00:00:00Z'),
      eta: new Date('2026-02-14T00:00:00Z'), qty: 5000, qtyUnit: 'pieces', matchKeys: mk,
    })
    .returning()
  await db.update(schema.shipments).set({ supersededById: leg2.id }).where(eq(schema.shipments.id, leg1.id))
  await db.insert(schema.shipmentPos).values({ shipmentId: leg2.id, poId: po.id, quantity: 5000, quantityUnit: 'pieces' })
  await db.insert(schema.shipmentMilestones).values([
    { shipmentId: leg1.id, milestoneType: 'BOOKING_SENT', occurredAt: new Date('2026-01-28T00:00:00Z'), senderType: 'forwarder' },
    { shipmentId: leg1.id, milestoneType: 'SO_RECEIVED', occurredAt: new Date('2026-01-30T00:00:00Z'), senderType: 'forwarder' },
    { shipmentId: leg2.id, milestoneType: 'BOOKING_SENT', occurredAt: new Date('2026-02-05T00:00:00Z'), senderType: 'forwarder' },
  ])

  // ---- an at-risk sea booking to exercise the alert evaluator (cut-off long past, no Final B/L) ----
  const [atRisk] = await db
    .insert(schema.bookings)
    .values({ jobNo: 'JOB-2026-0009', customerId: newlob.id, forwarderId: fwd[0].id, brand: 'SKIM' })
    .returning()
  const [atRiskLeg] = await db
    .insert(schema.shipments)
    .values({
      bookingId: atRisk.id, legNo: 1, mode: 'SEA', state: 'CONFIRMED', legStatus: 'ACTIVE',
      soNo: 'SO-RISK-1', bookingNo: 'BKG-RISK-1', cfsCutoff: new Date('2026-02-20T00:00:00Z'),
      polId: port('CNYTN')?.id, podId: port('USLAX')?.id, etd: new Date('2026-02-25T00:00:00Z'),
    })
    .returning()
  await db.insert(schema.shipmentMilestones).values([
    { shipmentId: atRiskLeg.id, milestoneType: 'BOOKING_SENT', occurredAt: new Date('2026-02-10T00:00:00Z'), senderType: 'forwarder' },
    { shipmentId: atRiskLeg.id, milestoneType: 'SO_RECEIVED', occurredAt: new Date('2026-02-12T00:00:00Z'), senderType: 'forwarder' },
  ])

  // ---- Pillar-4 alert rules (thresholds in hours; A2/A3 compute in vessel TZ; A3 locked) ----
  await db.insert(schema.alertRules).values([
    { id: 'A1', name: 'No SO after Booking', description: 'No SO within 48h of Booking Request', state: 'BOOKED', triggerType: 'days_after', triggerReference: 'booking_request', watchFor: 'so', thresholdHours: 48, severity: 'WARNING', computeTz: 'server' },
    { id: 'A2', name: 'Draft B/L before cut-off', description: 'Draft B/L not received 72h before cut-off', state: 'CONFIRMED', triggerType: 'days_before', triggerReference: 'cutoff', watchFor: 'draft_bl', thresholdHours: 72, severity: 'WARNING', computeTz: 'vessel' },
    { id: 'A3', name: 'Cut-off passed, no Final B/L', description: 'Cut-off passed without Final B/L', state: 'CONFIRMED', triggerType: 'days_after', triggerReference: 'cutoff', watchFor: 'final_bl', thresholdHours: 0, severity: 'CRITICAL', computeTz: 'vessel', locked: true },
    { id: 'A4', name: 'Telex after departure', description: 'Telex not received within 5d of departure', state: 'SAILED', triggerType: 'days_after', triggerReference: 'departure', watchFor: 'telex', thresholdHours: 120, severity: 'WARNING', computeTz: 'server' },
    { id: 'A5', name: 'Warehouse aging', description: 'In warehouse >14d with no departure', state: 'AT_WAREHOUSE', triggerType: 'days_after', triggerReference: 'warehouse_in', watchFor: 'sailed', thresholdHours: 336, severity: 'WARNING', computeTz: 'server' },
    { id: 'A6', name: 'Invoice missing', description: 'Final B/L issued but invoice missing >7d', state: 'RELEASED', triggerType: 'days_after', triggerReference: 'final_bl', watchFor: 'invoice', thresholdHours: 168, severity: 'WARNING', computeTz: 'server' },
  ])

  // ---- auth users (dev: every password is 'cobalt') ----
  const pw = await bcrypt.hash('cobalt', 10)
  await db.insert(schema.users).values([
    { email: 'viewer@cobalt.hk', name: 'Vera Viewer', passwordHash: pw, role: 'VIEWER', avatarInitials: 'VV' },
    { email: 'editor@cobalt.hk', name: 'Eddie Editor', passwordHash: pw, role: 'EDITOR', avatarInitials: 'EE' },
    { email: 'admin@cobalt.hk', name: 'Amon Admin', passwordHash: pw, role: 'ADMIN', avatarInitials: 'AA' },
    { email: 'super@cobalt.hk', name: 'Sue Super', passwordHash: pw, role: 'SUPERADMIN', avatarInitials: 'SS' },
    // service account the Agent VM (cobalt-queue Matcher) logs in as to POST decisions
    { email: 'agent@cobalt.hk', name: 'Cobalt Agent', passwordHash: pw, role: 'EDITOR', avatarInitials: 'AG' },
  ])

  // ---- app settings: the review-gate confidence threshold (admin-tunable) ----
  await db.insert(schema.appSettings).values({ key: 'confidence_threshold', value: 85 })

  // eslint-disable-next-line no-console
  console.log(`seed done: booking ${booking.jobNo} (${booking.id}) with legs ${leg1.legNo}(${leg1.legStatus}) / ${leg2.legNo}(${leg2.legStatus})`)
  await pool.end()
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e)
  process.exit(1)
})
