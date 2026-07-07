import { pgSchema, uuid, text, timestamp, boolean, integer, doublePrecision, jsonb, unique, index } from 'drizzle-orm/pg-core'
import {
  SHIPMENT_STATE, LEG_STATUS, SHIPMENT_MODE, RISK_LEVEL, REVIEW_STATUS, BOOKING_STATUS, QTY_UNIT,
  VENDOR_TYPE, FORWARDER_ALIAS_TYPE, PORT_MODE, USER_ROLE, MILESTONE_TYPE, WAREHOUSE_SIGNAL, FIELD_LOCK_ENTITY,
  MASTER_RESOLUTION_KIND, MASTER_RESOLUTION_STATUS, MASTER_RESOLUTION_SOURCE, SHIPMENT_IDENTIFIER_TYPE,
  SHIPMENT_PARTY_ROLE, EMAIL_TYPE, REVIEW_EMAIL_STATUS,
} from './enums'

/** TRUTH (mutable) + masters + auth. Owned and WRITTEN by track-system (VM1 NestJS). */
export const tracking = pgSchema('tracking')

// ============================================================
// MASTERS  (customers/vendors/POs synced from ERP; forwarders/ports/consignees ops-maintained)
// ============================================================
export const customers = tracking.table('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  erpSyncedAt: timestamp('erp_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const vendors = tracking.table('vendors', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code'),
  name: text('name').notNull(),
  type: text('type', { enum: VENDOR_TYPE }).notNull().default('factory'),
  location: text('location'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  notes: text('notes'),
  erpSyncedAt: timestamp('erp_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const forwarders = tracking.table('forwarders', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Forwarder aliases + email domains + Chinese names — fuel for the tiered resolver. */
export const forwarderAliases = tracking.table('forwarder_aliases', {
  id: uuid('id').primaryKey().defaultRandom(),
  forwarderId: uuid('forwarder_id').notNull().references(() => forwarders.id, { onDelete: 'cascade' }),
  aliasType: text('alias_type', { enum: FORWARDER_ALIAS_TYPE }).notNull(),
  value: text('value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('forwarder_aliases_type_value_uq').on(t.aliasType, t.value)])

export const consignees = tracking.table('consignees', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  address: text('address'),
  mapsToCustomerId: uuid('maps_to_customer_id').references(() => customers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const ports = tracking.table('ports', {
  id: uuid('id').primaryKey().defaultRandom(),
  unlocode: text('unlocode').notNull().unique(), // e.g. CNYTN, FRLEH, NLRTM
  name: text('name').notNull(),
  country: text('country'),
  mode: text('mode', { enum: PORT_MODE }).notNull().default('sea'),
  // IATA airport code (CNCAN → CAN) when the location has airport function — AIR legs display this.
  // Sourced from the UNECE UN/LOCODE list (IATA column override, else the 3-letter location part).
  iata: text('iata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('ports_iata_idx').on(t.iata)])

/**
 * Master RESOLUTION facts — the deterministic rules the parser's validator enforces, expressed as
 * DATA instead of hardcode: vendor-name aliases (ELEGANT SMART→ELSMCO), vendor name markers,
 * customer↔vendor links (ELGC→ELSMCO), forwarder ref patterns (^GZL\d{8}$→LOGIMARK). The SAME table
 * is the proposals store: `status` = approved/seed (live, served to the validator) vs proposed
 * (curated from corrections, awaiting human approval in the Masters UI) vs rejected. Agent proposes,
 * human disposes — `lhs` is the observed text/pattern/customer, `rhs` the code it resolves to.
 */
export const masterResolution = tracking.table('master_resolution', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind', { enum: MASTER_RESOLUTION_KIND }).notNull(),
  lhs: text('lhs').notNull(),
  rhs: text('rhs'),
  status: text('status', { enum: MASTER_RESOLUTION_STATUS }).notNull().default('proposed'),
  source: text('source', { enum: MASTER_RESOLUTION_SOURCE }).notNull().default('curator'),
  reason: text('reason'),
  evidence: jsonb('evidence').$type<unknown>(),
  createdBy: uuid('created_by').references(() => users.id),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('master_resolution_uq').on(t.kind, t.lhs, t.rhs)])

// ============================================================
// AUTH  (JWT + local accounts + RBAC)
// ============================================================
export const users = tracking.table('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: USER_ROLE }).notNull().default('VIEWER'),
  avatarInitials: text('avatar_initials'),
  active: boolean('active').notNull().default(true),
  /** forces a password change on next login (seeded accounts start true) */
  mustReset: boolean('must_reset').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const refreshTokens = tracking.table('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ============================================================
// PO  →  BOOKING  →  SHIPMENT (leg)
// ============================================================

/** PO — read-only mirror from ERP. The merchandising unit; never written by ShipTrack. */
export const purchaseOrders = tracking.table('purchase_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  poNumber: text('po_number').notNull().unique(), // natural key from ERP, e.g. "100-100209"
  customerId: uuid('customer_id').references(() => customers.id),
  vendorId: uuid('vendor_id').references(() => vendors.id),
  brand: text('brand'),
  itemStyleNo: text('item_style_no'),
  totalQuantity: doublePrecision('total_quantity'),
  quantityUnit: text('quantity_unit', { enum: QTY_UNIT }),
  crd: timestamp('crd', { withTimezone: true }),
  erpSyncedAt: timestamp('erp_synced_at', { withTimezone: true }),
  raw: jsonb('raw').$type<Record<string, unknown>>(), // ERP record snapshot
  notes: text('notes'), // app-owned free-text (PO is app-owned; ERP has no notes)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Booking — STABLE parent. `job_no` is system-assigned (NOT in any email), the human-quoted key. */
export const bookings = tracking.table('bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobNo: text('job_no').notNull().unique(),
  customerId: uuid('customer_id').references(() => customers.id),
  vendorId: uuid('vendor_id').references(() => vendors.id),
  forwarderId: uuid('forwarder_id').references(() => forwarders.id),
  consigneeId: uuid('consignee_id').references(() => consignees.id),
  brand: text('brand'),
  crd: timestamp('crd', { withTimezone: true }),
  status: text('status', { enum: BOOKING_STATUS }).notNull().default('ACTIVE'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // FK columns joined to masters when assembling shipment rows + used as list filters. (job_no's
  // unique already indexes the natural key.)
  index('bookings_customer_id_idx').on(t.customerId),
  index('bookings_vendor_id_idx').on(t.vendorId),
  index('bookings_forwarder_id_idx').on(t.forwarderId),
])

export const bookingPos = tracking.table('booking_pos', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'cascade' }),
  poId: uuid('po_id').notNull().references(() => purchaseOrders.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('booking_pos_uq').on(t.bookingId, t.poId),
  index('booking_pos_po_id_idx').on(t.poId), // booking_id is covered by the unique's leading col
])

/** Shipment leg — VOLATILE child. State + all mutable execution fields live here. */
export const shipments = tracking.table('shipments', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'cascade' }),
  legNo: integer('leg_no').notNull().default(1),
  // SHIPMENT = real leg on the tracker; DOCUMENT = orphan invoice/misc with no shipping identity, parked
  // in the "Unlinked Documents" view until a human links it (linked_shipment_id) onto a real shipment.
  kind: text('kind', { enum: ['SHIPMENT', 'DOCUMENT'] }).notNull().default('SHIPMENT'),
  linkedShipmentId: uuid('linked_shipment_id'), // logical self-FK → shipments.id (the leg a DOCUMENT was linked onto)
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }), // a human dismissed this DOCUMENT — drops it off the Unlinked Documents list
  mode: text('mode', { enum: SHIPMENT_MODE }), // null until known; drives sea/air display
  state: text('state', { enum: SHIPMENT_STATE }).notNull().default('BOOKED'),
  legStatus: text('leg_status', { enum: LEG_STATUS }).notNull().default('ACTIVE'),
  supersededById: uuid('superseded_by_id'), // logical self-FK → shipments.id (replacing leg)
  riskLevel: text('risk_level', { enum: RISK_LEVEL }).notNull().default('ON_TRACK'),
  // review gate (Pillar: commit-first). Agent decisions land confirmed/provisional by the Critic's
  // score vs the threshold; provisional legs are excluded from alerts until a human confirms.
  reviewStatus: text('review_status', { enum: REVIEW_STATUS }).notNull().default('confirmed'),
  confidence: integer('confidence'), // 0-100, the Critic's per-shipment score (null until scored)
  reviewReasons: jsonb('review_reasons').$type<string[]>(), // why the Critic flagged it (conflicts/notes)
  reviewedBy: uuid('reviewed_by').references(() => users.id), // human who confirmed/corrected it
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  confirmedByEmail: boolean('confirmed_by_email').notNull().default(false), // operator-first, email confirms later
  forwarderId: uuid('forwarder_id').references(() => forwarders.id),
  forwarderRaw: text('forwarder_raw'), // raw extracted forwarder — shown when forwarder_id doesn't resolve
  consigneeId: uuid('consignee_id').references(() => consignees.id),
  // rotating identifiers (booking# → SO# → HBL/AWB across the thread)
  bookingNo: text('booking_no'),
  soNo: text('so_no'),
  hblAwbFcrNo: text('hbl_awb_fcr_no'),
  mbl: text('mbl'),
  containerNo: text('container_no'),
  // sea-only
  vesselName: text('vessel_name'),
  voyageNo: text('voyage_no'),
  scacCode: text('scac_code'), // SCAC — ocean carrier code, extracted as-is (no master/validation)
  // air-only
  flightNo: text('flight_no'),
  mawb: text('mawb'),
  // route
  polId: uuid('pol_id').references(() => ports.id),
  podId: uuid('pod_id').references(() => ports.id),
  polRaw: text('pol_raw'), // raw extracted POL — shown when pol_id doesn't resolve to a UN/LOCODE master
  podRaw: text('pod_raw'), // raw extracted POD — shown when pod_id doesn't resolve
  originCountry: text('origin_country'), // ISO-2 from the POL port's country, denormalized at commit (alert evaluator reads it)
  // schedule (all timestamptz; A2/A3 alerts compute in vessel TZ)
  cargoReadyDate: timestamp('cargo_ready_date', { withTimezone: true }),
  cfsCutoff: timestamp('cfs_cutoff', { withTimezone: true }),
  warehouseStartDate: timestamp('warehouse_start_date', { withTimezone: true }),
  warehouseEndDate: timestamp('warehouse_end_date', { withTimezone: true }),
  etd: timestamp('etd', { withTimezone: true }),
  atd: timestamp('atd', { withTimezone: true }),
  eta: timestamp('eta', { withTimezone: true }),
  ata: timestamp('ata', { withTimezone: true }),
  inDcDate: timestamp('in_dc_date', { withTimezone: true }),
  // quantity for this leg + descriptive
  qty: doublePrecision('qty'),
  qtyUnit: text('qty_unit', { enum: QTY_UNIT }),
  grossWeight: doublePrecision('gross_weight'), // total gross weight (KGS) off the B/L / invoice
  measurement: doublePrecision('measurement'), // total measurement (CBM) off the B/L / invoice
  htsCode: text('hts_code'), // customs HTS/HS tariff code(s), comma-joined
  itemStyleNo: text('item_style_no'),
  consigneeName: text('consignee_name'),
  consigneeAddress: text('consignee_address'),
  // the bag of keys this leg can be matched on
  matchKeys: jsonb('match_keys').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('shipments_booking_leg_uq').on(t.bookingId, t.legNo),
  // The tracker/list/dashboard endpoints filter active legs and sort by recency; without an
  // index every request full-scans + sorts the shipments table (which grows unbounded).
  index('shipments_leg_status_updated_idx').on(t.legStatus, t.updatedAt),
  index('shipments_kind_idx').on(t.kind), // SHIPMENT vs DOCUMENT (Unlinked Documents) split
  index('shipments_review_status_idx').on(t.reviewStatus), // review queue / provisional filter
  index('shipments_state_idx').on(t.state), // dashboard state filters
  index('shipments_risk_level_idx').on(t.riskLevel), // dashboard "at risk" filter
  // FK columns — Postgres does not auto-index them. Hot join paths: legs-per-booking and the
  // presentation layer's per-booking PO enrichment.
  index('shipments_booking_id_idx').on(t.bookingId),
  index('shipments_forwarder_id_idx').on(t.forwarderId),
])

/** Partial-shipment split: which PO (and how much) rides on this leg. */
export const shipmentPos = tracking.table('shipment_pos', {
  id: uuid('id').primaryKey().defaultRandom(),
  shipmentId: uuid('shipment_id').notNull().references(() => shipments.id, { onDelete: 'cascade' }),
  poId: uuid('po_id').notNull().references(() => purchaseOrders.id),
  quantity: doublePrecision('quantity'),
  quantityUnit: text('quantity_unit', { enum: QTY_UNIT }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('shipment_pos_uq').on(t.shipmentId, t.poId),
  index('shipment_pos_po_id_idx').on(t.poId), // shipment_id is covered by the unique's leading col
])

/**
 * Identifier history + CO-CURRENT set — every value a shipment ever carried for each rotating identity
 * field. Identity is MULTI-VALUED: a consolidation / multi-container shipment legitimately carries many
 * current booking/SO/HBL numbers, so MULTIPLE rows per (shipment, type) may be `is_current`. The leg
 * column holds the primary/display value; this table keeps the full set, including superseded alternates
 * (a Draft B/L number replaced by the Final) which are `is_current = false`. Nothing extracted is lost —
 * searchable, with provenance, for the review UI. One row per (shipment, type, value).
 */
export const shipmentIdentifiers = tracking.table('shipment_identifiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  shipmentId: uuid('shipment_id').notNull().references(() => shipments.id, { onDelete: 'cascade' }),
  type: text('type', { enum: SHIPMENT_IDENTIFIER_TYPE }).notNull(),
  value: text('value').notNull(),
  docType: text('doc_type'), // the email type that stated it (Final B/L, Booking Request, …)
  rank: integer('rank'), // document authority (Final B/L = 5 … Other = 1)
  isCurrent: boolean('is_current').notNull().default(false), // a current value (≥1 per type: co-current consolidation members + the leg's primary)
  sourceEmailId: text('source_email_id'), // graph id → "view original"
  observedAt: timestamp('observed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('shipment_identifiers_uq').on(t.shipmentId, t.type, t.value)])

/**
 * Co-valid customer PARTIES — the entity analogue of shipment_identifiers. A buyer can present several
 * related legal entities in different roles on ONE shipment: the bill-to (whom we invoice), the
 * importer-of-record (e.g. American Eagle's Blue Star Imports), and the booking entity. booking.customer_id
 * holds the PRIMARY (the bill_to); this table keeps the full co-current set with role + provenance, written
 * only when ≥2 RELATED customer codes co-occur. One row per (shipment, role, customer_code). Additive:
 * nothing reads it until the committer's writeParties lands and relationship facts are curated.
 */
export const shipmentParties = tracking.table('shipment_parties', {
  id: uuid('id').primaryKey().defaultRandom(),
  shipmentId: uuid('shipment_id').notNull().references(() => shipments.id, { onDelete: 'cascade' }),
  role: text('role', { enum: SHIPMENT_PARTY_ROLE }).notNull(),
  customerId: uuid('customer_id').references(() => customers.id), // nullable: the code may not (yet) be a master row
  customerCode: text('customer_code').notNull(), // the CANONICAL master code (an alias is folded first)
  customerName: text('customer_name'),
  isPrimary: boolean('is_primary').notNull().default(false), // the one == booking.customer_id (the bill_to)
  docType: text('doc_type'), // the email type that stated it
  rank: integer('rank'), // document authority
  isCurrent: boolean('is_current').notNull().default(true),
  sourceEmailId: text('source_email_id'), // graph id → "view original"
  observedAt: timestamp('observed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('shipment_parties_uq').on(t.shipmentId, t.role, t.customerCode)])

export const shipmentMilestones = tracking.table('shipment_milestones', {
  id: uuid('id').primaryKey().defaultRandom(),
  shipmentId: uuid('shipment_id').notNull().references(() => shipments.id, { onDelete: 'cascade' }),
  milestoneType: text('milestone_type', { enum: MILESTONE_TYPE }).notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  signal: text('signal', { enum: WAREHOUSE_SIGNAL }), // which signal fired AT_WAREHOUSE
  senderType: text('sender_type'), // load-bearing: who signaled (vendor vs forwarder)
  evidenceRecordId: uuid('evidence_record_id'), // logical FK → evidence.parsed_record.id
  emailMessageId: text('email_message_id'), // graph id, for "view original"
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('shipment_milestones_shipment_id_idx').on(t.shipmentId)]) // load milestones per shipment

/** Every source email that contributed to a shipment — the "Related Emails" list. Separate from
 *  shipment_milestones because that dedupes by milestone type and skips unmapped ("Other"/Customs) emails,
 *  which still carry the shipment's data. */
export const shipmentEmails = tracking.table('shipment_emails', {
  id: uuid('id').primaryKey().defaultRandom(),
  shipmentId: uuid('shipment_id').notNull().references(() => shipments.id, { onDelete: 'cascade' }),
  graphMessageId: text('graph_message_id'),
  emailType: text('email_type'),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('shipment_emails_uq').on(t.shipmentId, t.graphMessageId),
  index('shipment_emails_graph_message_id_idx').on(t.graphMessageId), // "which shipments cite this email"
])

/** App settings — tracking-side tunables (e.g. the confidence threshold for the review gate).
 *  Key/value so the admin config page (and the decision router) read one row. */
export const appSettings = tracking.table('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Field-locks — a human edit WINS and LOCKS; the agent may never overwrite a locked field. */
export const fieldLocks = tracking.table('field_locks', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityType: text('entity_type', { enum: FIELD_LOCK_ENTITY }).notNull(),
  entityId: uuid('entity_id').notNull(),
  field: text('field').notNull(),
  lockedValue: text('locked_value'),
  lockedBy: uuid('locked_by').references(() => users.id),
  lockedAt: timestamp('locked_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('field_locks_uq').on(t.entityType, t.entityId, t.field)])

/**
 * EMAIL-EXTRACTION REVIEW QUEUE (track-system owned).
 * A denormalized snapshot of one email's parser output (mirrors evidence.parsed_record.fields) plus
 * the human review-state. Commit-first: the data is applied to shipments regardless; high-confidence
 * extractions are seeded AUTO_ACCEPTED, only low-confidence land NEEDS_REVIEW for a human to
 * approve / correct / reject AFTER the fact. We snapshot here (not just read the queue/evidence seam)
 * so the queue works standalone and the reviewer judges what was extracted at the time.
 * `message_id` / `graph_message_id` are logical FKs to queue.queue_message (no hard FK across the seam).
 */
export const reviewEmail = tracking.table('review_email', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: uuid('message_id'), // logical FK → queue.queue_message.id
  graphMessageId: text('graph_message_id'), // for "view original"
  subject: text('subject'),
  sender: text('sender'),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  bodyText: text('body_text'),
  emailType: text('email_type', { enum: EMAIL_TYPE }),
  // extracted_data is the current/effective extraction; original_extracted_data snapshots it before a
  // human correction; suggested_data is the matching agent's proposed changes (with reviewer_notes).
  extractedData: jsonb('extracted_data').$type<Record<string, unknown>>(),
  originalExtractedData: jsonb('original_extracted_data').$type<Record<string, unknown>>(),
  suggestedData: jsonb('suggested_data').$type<Record<string, unknown>>(),
  reviewerNotes: text('reviewer_notes'), // the matching agent's reasoning behind suggested_data
  extractionConfidence: doublePrecision('extraction_confidence'), // 0..1
  shipmentId: uuid('shipment_id').references(() => shipments.id, { onDelete: 'set null' }),
  reviewStatus: text('review_status', { enum: REVIEW_EMAIL_STATUS }).notNull().default('NEEDS_REVIEW'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewNotes: text('review_notes'), // the human's note on their decision
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('review_email_review_status_idx').on(t.reviewStatus), // the review-queue list filter
  index('review_email_shipment_id_idx').on(t.shipmentId), // FK: the shipment's review row(s)
  index('review_email_message_id_idx').on(t.messageId), // logical FK lookup by queue message
])

/** Inbox read-state (app-owned; queue.queue_message lives in the ingestion system). Global read-state,
 *  one row per message; the mark-read action upserts here. */
export const emailRead = tracking.table('email_read', {
  messageId: uuid('message_id').primaryKey(), // logical FK → queue.queue_message.id (no hard FK across the seam)
  readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  readBy: uuid('read_by').references(() => users.id),
})
