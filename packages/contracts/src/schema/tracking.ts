import { pgSchema, uuid, text, timestamp, boolean, integer, doublePrecision, jsonb, unique } from 'drizzle-orm/pg-core'
import {
  SHIPMENT_STATE, LEG_STATUS, SHIPMENT_MODE, RISK_LEVEL, BOOKING_STATUS, QTY_UNIT,
  VENDOR_TYPE, FORWARDER_ALIAS_TYPE, PORT_MODE, USER_ROLE, MILESTONE_TYPE, WAREHOUSE_SIGNAL, FIELD_LOCK_ENTITY,
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

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
})

export const bookingPos = tracking.table('booking_pos', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'cascade' }),
  poId: uuid('po_id').notNull().references(() => purchaseOrders.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('booking_pos_uq').on(t.bookingId, t.poId)])

/** Shipment leg — VOLATILE child. State + all mutable execution fields live here. */
export const shipments = tracking.table('shipments', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'cascade' }),
  legNo: integer('leg_no').notNull().default(1),
  mode: text('mode', { enum: SHIPMENT_MODE }), // null until known; drives sea/air display
  state: text('state', { enum: SHIPMENT_STATE }).notNull().default('BOOKED'),
  legStatus: text('leg_status', { enum: LEG_STATUS }).notNull().default('ACTIVE'),
  supersededById: uuid('superseded_by_id'), // logical self-FK → shipments.id (replacing leg)
  riskLevel: text('risk_level', { enum: RISK_LEVEL }).notNull().default('ON_TRACK'),
  confirmedByEmail: boolean('confirmed_by_email').notNull().default(false), // operator-first, email confirms later
  forwarderId: uuid('forwarder_id').references(() => forwarders.id),
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
  // air-only
  flightNo: text('flight_no'),
  mawb: text('mawb'),
  // route
  polId: uuid('pol_id').references(() => ports.id),
  podId: uuid('pod_id').references(() => ports.id),
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
  itemStyleNo: text('item_style_no'),
  consigneeName: text('consignee_name'),
  consigneeAddress: text('consignee_address'),
  // the bag of keys this leg can be matched on
  matchKeys: jsonb('match_keys').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('shipments_booking_leg_uq').on(t.bookingId, t.legNo)])

/** Partial-shipment split: which PO (and how much) rides on this leg. */
export const shipmentPos = tracking.table('shipment_pos', {
  id: uuid('id').primaryKey().defaultRandom(),
  shipmentId: uuid('shipment_id').notNull().references(() => shipments.id, { onDelete: 'cascade' }),
  poId: uuid('po_id').notNull().references(() => purchaseOrders.id),
  quantity: doublePrecision('quantity'),
  quantityUnit: text('quantity_unit', { enum: QTY_UNIT }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('shipment_pos_uq').on(t.shipmentId, t.poId)])

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
