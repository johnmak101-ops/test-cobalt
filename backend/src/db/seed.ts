/**
 * Seed the tracking + alerts schemas.
 *
 * ALWAYS (prod + dev): ports (no ERP home) + admin config (master_resolution facts, alert_rules, users,
 * app_settings), all idempotent (onConflictDoNothing) — never truncated, so runtime admin edits survive.
 *
 * SEED_DEMO=1 (dev/demo only): the demo dataset — demo masters (customers/vendors/forwarders/consignees),
 * a fixture PO/booking re-planned sea→air, the review queue, and the ingest mirror. Rebuilt from a truncate.
 * In PROD leave SEED_DEMO unset: masters come from the daily Cobalt Mesh sync (sync-masters.ts), not the seed.
 *
 * Run: pnpm --filter backend seed            (prod-shape: ports + config only)
 *      SEED_DEMO=1 pnpm --filter backend seed (full local demo dataset)
 */
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq, sql } from 'drizzle-orm'
import * as schema from './contracts'
import { seedAuthUsers } from './seed-auth-users'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/cobalt'

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const db = drizzle(pool, { schema })

  // SEED_DEMO gates the local demo dataset (masters + shipments + review queue). Prod seeds ONLY ports +
  // admin config; masters come from the daily Mesh sync (sync-masters.ts).
  const DEMO = process.env.SEED_DEMO === '1' || process.env.SEED_DEMO === 'true'

  // Demo rebuild: wipe the demo transactional data + demo masters (NOT master_resolution/app_settings/
  // alert_rules/users, which are admin-owned and preserved). Only in demo mode — never truncate real data.
  if (DEMO) {
    await db.execute(sql`truncate table
      tracking.review_email,
      tracking.shipment_pos, tracking.shipment_milestones, tracking.shipments,
      tracking.booking_pos, tracking.bookings, tracking.purchase_orders,
      tracking.field_locks, tracking.forwarder_aliases, tracking.consignees,
      tracking.forwarders, tracking.vendors, tracking.customers,
      tracking.refresh_tokens
      restart identity cascade`)
    await db.execute(sql`truncate table alerts.alerts restart identity cascade`)
  }

  // ---- ports (ALWAYS — no ERP home; idempotent so a prod reseed is a no-op) ----
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
      // widened origins/destinations seen in real evidence (data-wiring audit: route was null 98/98)
      { unlocode: 'CNTAO', name: 'Qingdao', country: 'CN', mode: 'sea' },
      { unlocode: 'CNNGB', name: 'Ningbo', country: 'CN', mode: 'sea' },
      { unlocode: 'CNCAN', name: 'Guangzhou', country: 'CN', mode: 'sea' },
      { unlocode: 'CNZUH', name: 'Zhuhai', country: 'CN', mode: 'sea' },
      { unlocode: 'CNYNT', name: 'Yantai', country: 'CN', mode: 'sea' },
      { unlocode: 'CNNSA', name: 'Nansha', country: 'CN', mode: 'sea' },
      { unlocode: 'HKHKG', name: 'Hong Kong', country: 'HK', mode: 'sea' },
      { unlocode: 'BDCGP', name: 'Chittagong', country: 'BD', mode: 'sea' },
      { unlocode: 'KHPNH', name: 'Phnom Penh', country: 'KH', mode: 'sea' },
      { unlocode: 'VNSGN', name: 'Ho Chi Minh', country: 'VN', mode: 'sea' },
      { unlocode: 'NLAMS', name: 'Amsterdam', country: 'NL', mode: 'sea' },
      { unlocode: 'SEGOT', name: 'Gothenburg', country: 'SE', mode: 'sea' },
      { unlocode: 'DEHAM', name: 'Hamburg', country: 'DE', mode: 'sea' },
      { unlocode: 'CATOR', name: 'Toronto', country: 'CA', mode: 'sea' },
      { unlocode: 'CAMTR', name: 'Montreal', country: 'CA', mode: 'sea' },
      { unlocode: 'USSEA', name: 'Seattle', country: 'US', mode: 'sea' },
      { unlocode: 'USJAX', name: 'Jacksonville', country: 'US', mode: 'sea' },
      { unlocode: 'USEWR', name: 'Newark', country: 'US', mode: 'sea' },
      { unlocode: 'USNYC', name: 'New York', country: 'US', mode: 'sea' },
      // widened again (origin-country/route audit): common ports seen in evidence that had no master row
      { unlocode: 'CNXMN', name: 'Xiamen', country: 'CN', mode: 'sea' },
      { unlocode: 'CNSHK', name: 'Shekou', country: 'CN', mode: 'sea' },
      { unlocode: 'CNCKG', name: 'Chongqing', country: 'CN', mode: 'sea' },
      { unlocode: 'CNZSN', name: 'Zhongshan', country: 'CN', mode: 'sea' },
      { unlocode: 'AUSYD', name: 'Sydney', country: 'AU', mode: 'sea' },
      { unlocode: 'KRINC', name: 'Incheon', country: 'KR', mode: 'sea' },
      { unlocode: 'CAVAN', name: 'Vancouver', country: 'CA', mode: 'sea' },
      { unlocode: 'GBSOU', name: 'Southampton', country: 'GB', mode: 'sea' },
      { unlocode: 'GBBHM', name: 'Birmingham', country: 'GB', mode: 'sea' },
      { unlocode: 'ESVLC', name: 'Valencia', country: 'ES', mode: 'sea' },
      { unlocode: 'BDDAC', name: 'Dhaka', country: 'BD', mode: 'sea' },
      { unlocode: 'AEKLF', name: 'Khor Fakkan', country: 'AE', mode: 'sea' },
    ])
    .onConflictDoNothing()
    .returning()
  const port = (code: string) => ports.find((p) => p.unlocode === code)

  // ---- curated master-resolution facts (ALWAYS — admin config, served via GET /api/masters/resolution;
  // cobalt-queue's parser reads them over HTTP). NOT gated behind SEED_DEMO: these include RELATIONSHIP facts
  // (customer_group/role, vendor_group) that are business knowledge, not name-inferable, and must survive. ----
  const MASTER_RESOLUTION_FACTS: { kind: (typeof schema.MASTER_RESOLUTION_KIND)[number]; lhs: string; rhs: string; reason: string }[] = [
    { kind: 'customer_canonical', lhs: 'COLEB', rhs: 'COLE', reason: 'group 3: duplicate master rows for Cole Buxton' },
    { kind: 'customer_group', lhs: 'SEH', rhs: 'PRIMARK', reason: 'group 13: SEH bootstraps as a Primark GROUP sibling (stays reviewed); flip in Settings → Resolution Rules if confirmed a hard fold' },
    { kind: 'customer_group', lhs: 'AEOW', rhs: 'AMERICAN_EAGLE', reason: 'groups 7-11: AEO Management (bill-to)' },
    { kind: 'customer_group', lhs: 'BLUI', rhs: 'AMERICAN_EAGLE', reason: 'groups 7-11: Blue Star Imports (AE importer-of-record)' },
    { kind: 'customer_group', lhs: 'TORL', rhs: 'TORY', reason: 'group 4: Tory US LLC' },
    { kind: 'customer_group', lhs: 'TOFE', rhs: 'TORY', reason: 'group 4: Tory HK / Far East' },
    { kind: 'customer_group', lhs: 'PRMK', rhs: 'PRIMARK', reason: 'Primark Ltd' },
    { kind: 'customer_group', lhs: 'PRMS', rhs: 'PRIMARK', reason: 'group 17: Primark regional sibling' },
    { kind: 'customer_group', lhs: 'PRMT', rhs: 'PRIMARK', reason: 'group 17: Primark regional sibling' },
    { kind: 'customer_role', lhs: 'AEOW', rhs: 'bill_to', reason: 'groups 7-10: pins primary -> auto-apply' },
    { kind: 'customer_role', lhs: 'BLUI', rhs: 'importer_of_record', reason: 'groups 7-11: retained as IOR co-valid member' },
    { kind: 'customer_role', lhs: 'PRMT', rhs: 'bill_to', reason: 'group 17: PRMT is the invoiced/main Primark party -> pins primary -> auto' },
    { kind: 'vendor_group', lhs: 'FEFALT', rhs: 'FENIX_FASHION', reason: 'group 2: Fenix Fashion HK (booking/invoice house)' },
    { kind: 'vendor_group', lhs: 'TALIUN', rhs: 'FENIX_FASHION', reason: 'group 2: Tai Li Un (mainland factory for the same shipment)' },
    { kind: 'vendor_group', lhs: 'YAQIHK', rhs: 'YAQI_AE', reason: 'group 11: Yaqi Textile HK (invoice house, American Eagle book)' },
    { kind: 'vendor_group', lhs: 'BANSNK', rhs: 'YAQI_AE', reason: 'group 11: BD Spinners & Knitters (Bangladesh factory on the same B/L)' },
  ]
  await db.insert(schema.masterResolution).values(
    MASTER_RESOLUTION_FACTS.map((f) => ({ ...f, status: 'approved' as const, source: 'seed' as const })),
  ).onConflictDoNothing()

  // ---- Pillar-4 alert rules (ALWAYS) — only A1/A2 active, country-aware, anchored on ETD ----
  await db.insert(schema.alertRules).values([
    { id: 'A1', name: 'No Draft BOL', description: 'No Draft B/L received after ETD', state: 'CONFIRMED', triggerType: 'days_after', triggerReference: 'etd', watchFor: 'draft_bl', thresholdHours: 24, countryThresholds: { BD: 48, KH: 48 }, severity: 'WARNING', computeTz: 'vessel' },
    { id: 'A2', name: 'No Final BOL', description: 'No Final B/L received after ETD', state: 'AT_WAREHOUSE', triggerType: 'days_after', triggerReference: 'etd', watchFor: 'final_bl', thresholdHours: 72, countryThresholds: { BD: 168, KH: 168 }, severity: 'WARNING', computeTz: 'vessel' },
  ]).onConflictDoNothing()

  // ---- auth accounts (ALWAYS): 2 human admins + the Agent VM service account ----
  await seedAuthUsers(db)

  // ---- app settings (ALWAYS): the review-gate confidence threshold ----
  await db.insert(schema.appSettings).values({ key: 'confidence_threshold', value: 85 }).onConflictDoNothing()

  if (!DEMO) {
    console.log('seed done: ports + admin config only (masters via the daily Mesh sync). Set SEED_DEMO=1 for the demo dataset.')
    await pool.end()
    return
  }

  // ======================= DEMO DATASET (SEED_DEMO=1 only) =======================

  // ---- demo masters ----
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

  // ---- email-extraction review queue (demo) ----
  const [reviewerUser] = await db.select().from(schema.users).where(eq(schema.users.email, 'admin@cobalt.hk'))
  const reviewRows = await db.insert(schema.reviewEmail).values([
    // — pending, LOW confidence, sparse, no agent suggestion (plain extracted-data view) —
    {
      graphMessageId: 'mock:delay-notice-evergreen.msg',
      subject: 'Vessel delay — EVER GLOBE 0114-068E',
      sender: 'ops@torque-shipair.example',
      receivedAt: new Date('2026-02-08T03:12:00Z'),
      bodyText: 'Please note EVER GLOBE voyage 0114-068E is delayed. New ETD 12 Feb, ETA 07 Mar. Booking 118997.',
      emailType: 'Other',
      extractionConfidence: 0.42,
      reviewStatus: 'NEEDS_REVIEW',
      shipmentId: leg2.id,
      extractedData: {
        customer_po: '100-100209', booking_no: '118997', so_no: 'SESZX_0286_26_RZ',
        etd: '2026-02-12', eta: '2026-03-07',
      },
    },
    // — pending, MEDIUM confidence, WITH agent suggestion + reasoning (drives the comparison/diff view) —
    {
      graphMessageId: 'mock:final-bl-118997.msg',
      subject: 'Final B/L — HBL TQHK1180994 / Booking 118997',
      sender: 'docs@torque-shipair.example',
      receivedAt: new Date('2026-02-11T09:40:00Z'),
      bodyText: 'Final B/L attached. HBL TQHK118099 4. Vessel EVER LUCKY. Container TQHU1234567.',
      emailType: 'Final B/L',
      extractionConfidence: 0.65,
      reviewStatus: 'NEEDS_REVIEW',
      shipmentId: leg2.id,
      reviewerNotes:
        'Booking number looks truncated — the trailing "4" likely belongs to the HBL "TQHK1180994", not the booking. Vessel "EVER LUCKY" conflicts with this leg’s vessel "EVER GLOBE".',
      extractedData: {
        customer_po: '100-100209', booking_no: '1189974', hbl_awb_fcr_no: 'TQHK118099',
        container_no: 'TQHU1234567', forwarder_name: 'Torque / Shipair',
      },
      suggestedData: {
        customer_po: '100-100209', booking_no: '118997', hbl_awb_fcr_no: 'TQHK1180994',
        container_no: 'TQHU1234567', forwarder_name: 'Torque / Shipair',
      },
    },
    // — pending, MEDIUM confidence, suggestion fixing a consignee typo —
    {
      graphMessageId: 'mock:so-confirm-newlob.msg',
      subject: 'SO confirmation — 100-100209',
      sender: 'cs@newlobster.example',
      receivedAt: new Date('2026-01-30T11:05:00Z'),
      bodyText: 'SO SESZX_0286_26_RZ confirmed for PO 100-100209. Consignee CINQ-HUITIEMES SA, Paris.',
      emailType: 'SO',
      extractionConfidence: 0.71,
      reviewStatus: 'NEEDS_REVIEW',
      shipmentId: leg2.id,
      reviewerNotes: 'Consignee name missing the suffix — the master record is "CINQ-HUITIEMES S.A.".',
      extractedData: {
        customer_po: '100-100209', so_no: 'SESZX_0286_26_RZ', consignee_name: 'CINQ-HUITIEMES SA',
        consignee_address: 'Paris, France', cargo_ready_date: '2026-02-03',
      },
      suggestedData: {
        customer_po: '100-100209', so_no: 'SESZX_0286_26_RZ', consignee_name: 'CINQ-HUITIEMES S.A.',
        consignee_address: 'Paris, France', cargo_ready_date: '2026-02-03',
      },
    },
    // — already CORRECTED by a human (Corrected tab + before/after diff) —
    {
      graphMessageId: 'mock:booking-req-risk.msg',
      subject: 'Booking request — SKIM / SO-RISK-1',
      sender: 'ops@torque-shipair.example',
      receivedAt: new Date('2026-02-10T08:00:00Z'),
      bodyText: 'Booking BKG-RISK-1 raised for SKIM. CFS cut-off 20 Feb. POL Yantian, POD Los Angeles.',
      emailType: 'Booking Request',
      extractionConfidence: 0.6,
      reviewStatus: 'REVIEWED_CORRECTED',
      shipmentId: atRiskLeg.id,
      reviewedBy: reviewerUser?.id ?? null,
      reviewedAt: new Date('2026-02-10T10:30:00Z'),
      reviewNotes: 'Fixed booking number (OCR dropped a digit) and set the correct CFS cut-off date.',
      originalExtractedData: {
        booking_no: 'BKG-RISK-l', so_no: 'SO-RISK-1', warehouse_end_date: '2026-02-02', poi: 'Yantian', pod: 'Los Angeles',
      },
      extractedData: {
        booking_no: 'BKG-RISK-1', so_no: 'SO-RISK-1', warehouse_end_date: '2026-02-20', poi: 'Yantian', pod: 'Los Angeles',
      },
    },
    // — rejected (not a shipment email) —
    {
      graphMessageId: 'mock:marketing-blast.msg',
      subject: 'Q1 freight rates promotion',
      sender: 'marketing@randomfreight.example',
      receivedAt: new Date('2026-02-09T14:00:00Z'),
      bodyText: 'Special rates this quarter! Contact us for a quote.',
      emailType: 'Other',
      extractionConfidence: 0.18,
      reviewStatus: 'REJECTED',
      reviewedBy: reviewerUser?.id ?? null,
      reviewedAt: new Date('2026-02-09T14:20:00Z'),
      reviewNotes: 'Marketing email — not a shipment document.',
      extractedData: {},
    },
    // — auto-accepted (high confidence; applied automatically — counts only, never shown in a tab) —
    {
      graphMessageId: 'mock:so-auto-1.msg',
      subject: 'SO SESZX_0286_26_RZ',
      sender: 'cs@newlobster.example',
      receivedAt: new Date('2026-01-29T09:00:00Z'),
      emailType: 'SO',
      extractionConfidence: 0.96,
      reviewStatus: 'AUTO_ACCEPTED',
      shipmentId: leg2.id,
      extractedData: { customer_po: '100-100209', so_no: 'SESZX_0286_26_RZ', booking_no: '118997' },
    },
    {
      graphMessageId: 'mock:bkg-auto-2.msg',
      subject: 'Booking confirmation 118997',
      sender: 'ops@torque-shipair.example',
      receivedAt: new Date('2026-01-28T08:00:00Z'),
      emailType: 'Booking Request',
      extractionConfidence: 0.94,
      reviewStatus: 'AUTO_ACCEPTED',
      shipmentId: leg2.id,
      extractedData: { customer_po: '100-100209', booking_no: '118997', forwarder_name: 'Torque / Shipair' },
    },
  ]).returning()

  // Mirror each review email into ingest.* — track-system's own copy (production: POST /api/decisions).
  const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null)
  const MATCH_KEY_FIELDS = ['customer_po', 'so_no', 'booking_no', 'hbl_awb_fcr_no', 'mbl', 'conversation_id'] as const
  const pickMatchKeys = (fields: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const k of MATCH_KEY_FIELDS) if (fields[k] !== undefined) out[k] = fields[k]
    return out
  }

  await db.execute(sql`delete from ingest.email_message where graph_message_id like 'mock:%'`)
  for (const r of reviewRows) {
    if (!r.graphMessageId) continue
    const isPending = r.reviewStatus === 'NEEDS_REVIEW'

    const [ingMsg] = await db
      .insert(schema.ingestEmailMessage)
      .values({
        graphMessageId: r.graphMessageId,
        subject: r.subject,
        sender: r.sender,
        receivedAt: r.receivedAt,
        status: 'DONE',
        attachmentCount: isPending ? 1 : 0,
        bodyText: r.bodyText,
      })
      .returning()
    await db.update(schema.reviewEmail).set({ messageId: ingMsg.id }).where(eq(schema.reviewEmail.id, r.id))

    const extracted = (r.extractedData ?? {}) as Record<string, unknown>
    await db.insert(schema.ingestParsedRecord).values({
      messageId: ingMsg.id,
      graphMessageId: r.graphMessageId,
      poNo: strOrNull(extracted.customer_po),
      emailType: r.emailType ?? null,
      fields: extracted,
      matchKeys: pickMatchKeys(extracted),
    })

    if (!isPending) continue
    const csv = 'PO,Item / Style,Qty,Unit\n100-100209,KT-771,5000,pieces'
    await db.insert(schema.ingestEmailAttachment).values({
      messageId: ingMsg.id,
      filename: 'packing-list.csv',
      declaredMime: 'text/csv',
      sizeBytes: csv.length,
      sourceKind: 'csv',
      rawBytes: Buffer.from(csv, 'utf-8'),
    })
  }

  await db
    .insert(schema.ingestSyncState)
    .values({ id: 'inbox:mock', watermark: new Date(), lastSyncAt: new Date() })
    .onConflictDoUpdate({
      target: schema.ingestSyncState.id,
      set: { watermark: new Date(), lastSyncAt: new Date(), updatedAt: new Date() },
    })

  console.log(`seed done (demo): booking ${booking.jobNo} (${booking.id}) with legs ${leg1.legNo}(${leg1.legStatus}) / ${leg2.legNo}(${leg2.legStatus})`)
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
