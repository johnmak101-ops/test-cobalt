/** Derive the unified 6-state staircase from the signals present (highest reached wins). */

const ORDER = ['BOOKED', 'CONFIRMED', 'AT_WAREHOUSE', 'SAILED', 'RELEASED', 'DELIVERED'] as const
export type ShipmentState = (typeof ORDER)[number]

const has = (v: unknown) => v != null && v !== ''

export function deriveState(
  emailTypes: Set<string>,
  fields: Record<string, unknown>,
  now: Date = new Date(),
): ShipmentState {
  let s: ShipmentState = 'BOOKED'
  const bump = (to: ShipmentState) => {
    if (ORDER.indexOf(to) > ORDER.indexOf(s)) s = to
  }
  if (emailTypes.has('SO') || has(fields.so_no)) bump('CONFIRMED')
  // AT_WAREHOUSE = earliest of forwarder CFS / vendor warehouse confirm / Draft B/L (fallback)
  if (has(fields.warehouse_start_date) || emailTypes.has('Draft B/L')) bump('AT_WAREHOUSE')
  if (has(fields.atd)) bump('SAILED')
  // BUG 7: an Invoice/Billing shipment carrying a cut MBL with a PAST ETD has demonstrably sailed even without
  // an explicit ATD (invoices are issued post-departure). Tightly gated to that exact combination — NOT a broad
  // has(mbl)->SAILED nor vessel+past-etd->SAILED, both of which false-promote drafts / booking-requests.
  if (emailTypes.has('Invoice/Billing') && has(fields.mbl) && has(fields.etd)) {
    const etd = new Date(String(fields.etd))
    if (!Number.isNaN(etd.getTime()) && etd.getTime() < now.getTime()) bump('SAILED')
  }
  if (emailTypes.has('Telex Release') || emailTypes.has('Final B/L')) bump('RELEASED')
  // A delivery cannot precede departure: only bump to DELIVERED when there is also a departure signal.
  if (has(fields.in_dc_date) && (has(fields.atd) || emailTypes.has('Final B/L') || emailTypes.has('Telex Release'))) bump('DELIVERED')
  return s
}

/**
 * Split a committed leg into SHIPMENT (a real shipment with a shipping identity) vs DOCUMENT (an orphan
 * invoice / customs / misc email — parked in "Unlinked Documents" until a human links it to its shipment).
 * A leg is a DOCUMENT when EITHER:
 *   (a) it carries none of the rotating identity numbers AND was built from no lifecycle email type — a bare
 *       orphan (invoice/customs/other with no id). A Booking Request with no booking# yet stays SHIPMENT.
 *   (b) it was built ENTIRELY from CVP Invoice/Billing (vendor-invoice) notifications AND carries no
 *       booking#/BL/MBL/container — only an order-reference so_no. An SO on a vendor invoice is an ORDER
 *       reference, not proof of a booked move, so such a leg is an invoice record, not a shipment. (A genuine
 *       SO *document* is a lifecycle type → hasLifecycle, so it is unaffected.)
 *   (c) it was built ENTIRELY from the CVP/TradeLinkOne notification platform (every source email sent by
 *       the portal — opts.fromPlatform), carries no lifecycle email, AND carries no real CARRIER identity
 *       (BL/MBL/container). Such a leg is a vendor/PO notification (e.g. a "Vendor Delivery Date – Past due"
 *       alert); the portal leaks its own LPO reference into booking_no, so booking_no here is an order ref,
 *       not a booked move. Field shape alone can't catch this — an invoice carrying a genuine booking# IS a
 *       shipment (see (b)/tests) — so the discriminator is the platform sender. A platform e-invoice that
 *       reports a real BL/MBL/container still falls through to SHIPMENT.
 */
const IDENTITY_FIELDS = ['booking_no', 'so_no', 'hbl_awb_fcr_no', 'mbl', 'container_no'] as const
/** Identities that PROVE a booked move — so_no EXCLUDED (an invoice's SO is an order ref, see (b)). */
const SHIPMENT_IDENTITY = ['booking_no', 'hbl_awb_fcr_no', 'mbl', 'container_no'] as const
/** Carrier-issued identities — booking_no EXCLUDED (the portal leaks an LPO into it, see (c)). */
const CARRIER_IDENTITY = ['hbl_awb_fcr_no', 'mbl', 'container_no'] as const
const LIFECYCLE_TYPES = new Set(['Booking Request', 'SO', 'Draft B/L', 'Final B/L', 'Telex Release'])
/**
 * Classification rule. STEP 2/3 de-correction (2026-07-12):
 *   (a) bare_orphan → DOCUMENT (genuine no-identity)
 *   (b)/(c) invoice_so_ref / platform_only → SHIPMENT + review flag (no silent demotion;
 *       queue LLM/soul owns classification; track only surfaces doubt)
 */
export type ClassifyRule = 'bare_orphan' | 'invoice_so_ref' | 'platform_only'

export function classifyKindDetail(
  emailTypes: Set<string>,
  fields: Record<string, unknown>,
  opts: { fromPlatform?: boolean } = {},
): { kind: 'SHIPMENT' | 'DOCUMENT'; rule: ClassifyRule | null } {
  const hasIdentity = IDENTITY_FIELDS.some((k) => has(fields[k]))
  const hasLifecycle = [...emailTypes].some((t) => LIFECYCLE_TYPES.has(t))
  if (!hasIdentity && !hasLifecycle) return { kind: 'DOCUMENT', rule: 'bare_orphan' } // (a) bare orphan
  const invoiceOnly = emailTypes.size > 0 && [...emailTypes].every((t) => t === 'Invoice/Billing')
  const hasShipmentIdentity = SHIPMENT_IDENTITY.some((k) => has(fields[k]))
  // (b) was DOCUMENT demotion — now SHIPMENT + flag for human review
  if (invoiceOnly && !hasShipmentIdentity) return { kind: 'SHIPMENT', rule: 'invoice_so_ref' }
  const hasCarrierIdentity = CARRIER_IDENTITY.some((k) => has(fields[k]))
  // (c) was DOCUMENT demotion for platform-only LPO — now SHIPMENT + flag
  if (opts.fromPlatform && !hasLifecycle && !hasCarrierIdentity) return { kind: 'SHIPMENT', rule: 'platform_only' }
  return { kind: 'SHIPMENT', rule: null }
}

/** Thin wrapper returning the kind alone — the existing call surface (reclassify script, tests). */
export function classifyKind(
  emailTypes: Set<string>,
  fields: Record<string, unknown>,
  opts: { fromPlatform?: boolean } = {},
): 'SHIPMENT' | 'DOCUMENT' {
  return classifyKindDetail(emailTypes, fields, opts).kind
}

/** Which milestone an email type records (null = no milestone). */
export const MILESTONE_OF: Record<string, string> = {
  'Booking Request': 'BOOKING_SENT',
  SO: 'SO_RECEIVED',
  'Draft B/L': 'DRAFT_BL_RECEIVED',
  'Final B/L': 'FINAL_BL_RECEIVED',
  'Telex Release': 'TELEX_RELEASED',
  'Invoice/Billing': 'INVOICE_RECEIVED',
}

/**
 * BUG 7: milestones derived from FIELD PRESENCE, not from an email type — so a leg whose deriveState reached
 * AT_WAREHOUSE / SAILED via field values (warehouse_start_date / atd) also gets a timeline row and the
 * timeline no longer lags the derived state. Each entry is [fieldName, milestoneType]; the milestone is dated
 * by that field's value. AT_WAREHOUSE is a first-class MILESTONE_TYPE; SAILED has no email-type analogue, so
 * it's a derived-only milestone (milestone_type is a free-text column — see committer.syncMilestones).
 */
export const DERIVED_MILESTONE_OF: Array<{ field: string; milestone: string }> = [
  { field: 'warehouse_start_date', milestone: 'AT_WAREHOUSE' },
  { field: 'atd', milestone: 'SAILED' },
]

/** Normalize the parser's mode label to the schema enum. */
export function normMode(mode: string | null): string | null {
  if (!mode) return null
  const m: Record<string, string> = { Sea: 'SEA', 'Sea-FCL': 'SEA_FCL', 'Sea-LCL': 'SEA_LCL', Air: 'AIR' }
  if (m[mode]) return m[mode]
  if (mode.toLowerCase().startsWith('sea')) return 'SEA'
  if (mode.toLowerCase().startsWith('air')) return 'AIR'
  return null
}
