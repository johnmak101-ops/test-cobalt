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
 *  (held for human review, excluded from alerts/automation) or `confirmed` (auto-applied). */
export const REVIEW_STATUS = ['provisional', 'confirmed'] as const

// ---- Booking (the stable parent) ----
export const BOOKING_STATUS = ['ACTIVE', 'CLOSED', 'CANCELLED'] as const

// ---- Shared ----
export const QTY_UNIT = ['cartons', 'pieces', 'cbm'] as const
export const VENDOR_TYPE = ['factory', 'subcontractor', 'agent'] as const
export const FORWARDER_ALIAS_TYPE = ['name', 'domain', 'chinese_name'] as const
/** master_resolution — the resolution facts the validator enforces, curated from human corrections. */
export const MASTER_RESOLUTION_KIND = ['vendor_alias', 'vendor_name_marker', 'customer_vendor', 'consignee_for_customer', 'forwarder_ref'] as const
export const MASTER_RESOLUTION_STATUS = ['approved', 'proposed', 'rejected'] as const
export const MASTER_RESOLUTION_SOURCE = ['seed', 'curator', 'ops'] as const
export const PORT_MODE = ['sea', 'air', 'both'] as const
export const USER_ROLE = ['VIEWER', 'EDITOR', 'ADMIN', 'SUPERADMIN'] as const

// ---- Milestones (event log) ----
export const MILESTONE_TYPE = [
  'BOOKING_SENT', 'SO_RECEIVED', 'AT_WAREHOUSE', 'DRAFT_BL_RECEIVED',
  'FINAL_BL_RECEIVED', 'TELEX_RELEASED', 'INVOICE_RECEIVED', 'DELIVERED',
] as const
/** AT_WAREHOUSE fires on the EARLIEST of these signals; the milestone records which one. */
export const WAREHOUSE_SIGNAL = ['forwarder_cfs', 'vendor_confirm', 'draft_bl'] as const
export const SENDER_TYPE = ['vendor', 'forwarder', 'carrier', 'customs', 'internal'] as const
export const EMAIL_TYPE = [
  'Booking Request', 'SO', 'Draft B/L', 'Final B/L', 'Telex Release', 'Invoice/Billing', 'Customs', 'Other',
] as const

// ---- Field-locks (human-wins) ----
export const FIELD_LOCK_ENTITY = ['booking', 'shipment'] as const

// ---- Audit ----
export const AUDIT_ENTITY = [
  'booking', 'shipment', 'milestone', 'purchase_order', 'alert', 'field_lock', 'booking_po', 'shipment_po',
] as const
export const CHANGE_TYPE = ['create', 'update', 'delete', 'supersede', 'merge'] as const
export const SOURCE_TYPE = ['email', 'manual', 'system', 'agent'] as const

// ---- Alerts (Pillar-4) ----
export const ALERT_SEVERITY = ['CRITICAL', 'WARNING', 'INFO'] as const
export const ALERT_STATUS = ['ACTIVE', 'DISMISSED', 'SNOOZED', 'RESOLVED'] as const
export const ALERT_TRIGGER_TYPE = ['days_after', 'days_before'] as const
/** The anchor a rule measures from. */
export const ALERT_TRIGGER_REF = ['booking_request', 'cutoff', 'departure', 'warehouse_in', 'final_bl'] as const
/** The thing whose ABSENCE fires the rule. */
export const ALERT_WATCH_FOR = ['so', 'draft_bl', 'final_bl', 'telex', 'sailed', 'invoice'] as const
/** A2/A3 must compute in the vessel's timezone, not the server's. */
export const COMPUTE_TZ = ['server', 'vessel'] as const

// ---- Match boundary (VM2 agent -> VM1 committer) ----
export const MATCH_ACTION = [
  'create_booking', 'add_leg', 'amend_fields', 'merge_into_leg', 'flag_conflict', 'needs_review',
] as const
export const MATCH_REQUEST_STATUS = ['PENDING', 'CLAIMED', 'DONE', 'FAILED'] as const
export const MATCH_DECISION_STATUS = ['PENDING_COMMIT', 'COMMITTED', 'REJECTED', 'NEEDS_REVIEW'] as const
export const CONFIDENCE = ['high', 'medium', 'low'] as const
