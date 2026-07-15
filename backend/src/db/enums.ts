/**
 * Shared enum value arrays — the single source of truth for both Drizzle (`{ enum: ... }`)
 * and Zod. `as const` keeps them literal so column types and validators stay in lockstep.
 */

// ---- Shipment leg (the volatile child) ----
/** Unified 6-state staircase for sea AND air; differences are display-only, driven by `mode`. */
export const SHIPMENT_STATE = ['BOOKED', 'CONFIRMED', 'AT_WAREHOUSE', 'SAILED', 'RELEASED', 'DELIVERED'] as const
/** A leg can be superseded (e.g. sea→air re-plan) without deleting its history. */
export const LEG_STATUS = ['ACTIVE', 'SUPERSEDED', 'CANCELLED'] as const
export const SHIPMENT_MODE = ['SEA', 'SEA_FCL', 'SEA_LCL', 'AIR'] as const
export const RISK_LEVEL = ['ON_TRACK', 'AT_RISK', 'DELAYED'] as const
/** Per-shipment review gate. The Critic's confidence routes a decision to `provisional`
 *  (held for human review, excluded from alerts/automation) or `confirmed` (auto-applied).
 *  (A `skip`/不需處理 decision never becomes a leg — DecisionsService short-circuits it, so no third
 *  column value is needed here.) */
export const REVIEW_STATUS = ['provisional', 'confirmed'] as const
/** The rotating identifier kinds a shipment carries across its lifecycle (booking# → SO# → HBL/AWB).
 *  Every value ever stated is retained in shipment_identifiers; the leg column holds the current one. */
export const SHIPMENT_IDENTIFIER_TYPE = ['booking_no', 'so_no', 'hbl_awb_fcr_no', 'mbl', 'container_no'] as const
/** The role a customer entity plays on a shipment. A buyer can present a bill-to AND an importer-of-record
 *  AND a booking entity — all co-valid parties of ONE shipment, retained in shipment_parties. The leg's
 *  booking.customer_id holds the PRIMARY (the bill_to). */
export const SHIPMENT_PARTY_ROLE = ['bill_to', 'importer_of_record', 'booking_entity', 'consignee', 'other'] as const

// ---- Booking (the stable parent) ----
export const BOOKING_STATUS = ['ACTIVE', 'CLOSED', 'CANCELLED'] as const

// ---- Shared ----
// honest unit vocabulary — a stated '20PAC' is packages, never relabeled cartons; 'containers' for FCL
export const QTY_UNIT = ['cartons', 'pieces', 'cbm', 'packages', 'pallets', 'units', 'containers', 'sets'] as const
export const VENDOR_TYPE = ['factory', 'subcontractor', 'agent'] as const
export const FORWARDER_ALIAS_TYPE = ['name', 'domain', 'chinese_name'] as const
/** master_resolution — the resolution facts the validator enforces, curated from human corrections.
 *  customer_canonical (alias code → survivor code, COLEB→COLE), customer_group (code → buyer-group id),
 *  customer_role (code → bill_to/importer_of_record/booking_entity), vendor_group (code → vendor-group id,
 *  the vendor-side analogue of customer_group — a booking/invoice house and its manufacturing factory
 *  co-valid on the same shipment) drive the co-valid entity model. */
export const MASTER_RESOLUTION_KIND = [
  'vendor_alias', 'vendor_name_marker', 'customer_vendor', 'consignee_for_customer', 'forwarder_ref',
  'customer_canonical', 'customer_group', 'customer_role', 'vendor_group', 'prior_correction',
  'port_abbreviation', 'port_alias', 'port_iata', 'port_fragment',
  // Iterator MOVE 3 — party facts as data (queue party-rules + track platform scrub consume these)
  'platform_not_forwarder', 'genuine_short_brand', 'self_identity',
  // Wave 4 #145 — curated exact forwarder name → code (committer pre-lookup; exact-only)
  'forwarder_alias',
] as const
export const MASTER_RESOLUTION_STATUS = ['approved', 'proposed', 'rejected'] as const
export const MASTER_RESOLUTION_SOURCE = ['seed', 'curator', 'ops'] as const
export const PORT_MODE = ['sea', 'air', 'both'] as const
export const USER_ROLE = ['VIEWER', 'EDITOR', 'ADMIN', 'SUPERADMIN'] as const

// ---- Milestones (event log) ----
export const MILESTONE_TYPE = [
  'BOOKING_SENT', 'SO_RECEIVED', 'AT_WAREHOUSE', 'DRAFT_BL_RECEIVED',
  // SAILED is a DERIVED milestone (atd → SAILED, or the etd-fallback when state reached SAILED with no
  // atd) — deriveMilestoneRows emits it and the UI reads milestoneMap.get('SAILED') for the Departure step.
  // It MUST be in this enum + the ck_shipment_milestones_type CHECK (mig 0009), else EVERY sailed shipment's
  // milestone INSERT fails, which also skips the related-email write in the same sync() → blank timeline + no
  // "Related Emails".
  'FINAL_BL_RECEIVED', 'SAILED', 'TELEX_RELEASED', 'INVOICE_RECEIVED', 'DELIVERED',
] as const
/** AT_WAREHOUSE fires on the EARLIEST of these signals; the milestone records which one. */
export const WAREHOUSE_SIGNAL = ['forwarder_cfs', 'vendor_confirm', 'draft_bl'] as const
export const SENDER_TYPE = ['vendor', 'forwarder', 'carrier', 'customs', 'internal'] as const
export const EMAIL_TYPE = [
  'Booking Request', 'SO', 'Draft B/L', 'Final B/L', 'Telex Release', 'Invoice/Billing', 'Customs', 'Other',
] as const

// ---- Email-extraction review queue (track-system owned) ----
// Commit-first: high-confidence extractions land AUTO_ACCEPTED (already applied); only low-confidence
// land NEEDS_REVIEW for a human to approve / correct / reject after the fact.
export const REVIEW_EMAIL_STATUS = [
  'NEEDS_REVIEW', 'AUTO_ACCEPTED', 'REVIEWED_OK', 'REVIEWED_CORRECTED', 'REJECTED',
] as const

// ---- Field-locks (human-wins) ----
export const FIELD_LOCK_ENTITY = ['booking', 'shipment'] as const

// ---- Audit ----
export const AUDIT_ENTITY = [
  'booking', 'shipment', 'milestone', 'purchase_order', 'alert', 'field_lock', 'booking_po', 'shipment_po',
] as const
// 'shadow' = a de-correction measurement row: "code would have corrected X" recorded WITHOUT changing
// behavior, so the model's error-rate is queryable. Excluded from every user-facing audit/history read.
export const CHANGE_TYPE = ['create', 'update', 'delete', 'supersede', 'merge', 'shadow'] as const
export const SOURCE_TYPE = ['email', 'manual', 'system', 'agent'] as const

// ---- Alerts (Pillar-4) ----
export const ALERT_SEVERITY = ['CRITICAL', 'WARNING', 'INFO'] as const
export const ALERT_STATUS = ['ACTIVE', 'DISMISSED', 'SNOOZED', 'RESOLVED'] as const
export const ALERT_TRIGGER_TYPE = ['days_after', 'days_before'] as const
/** The anchor a rule measures from. */
export const ALERT_TRIGGER_REF = ['booking_request', 'cutoff', 'departure', 'warehouse_in', 'final_bl', 'etd'] as const
/** The thing whose ABSENCE fires the rule. */
export const ALERT_WATCH_FOR = ['so', 'draft_bl', 'final_bl', 'telex', 'sailed', 'invoice'] as const
/** A2/A3 must compute in the vessel's timezone, not the server's. */
export const COMPUTE_TZ = ['server', 'vessel'] as const
