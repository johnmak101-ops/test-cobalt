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
 * invoice / customs / misc email with no identity — parked in "Unlinked Documents" until a human links it).
 * DOCUMENT only when BOTH: (a) it carries none of the rotating identity numbers, AND (b) it was built from
 * none of the lifecycle email types. So a Booking Request with no booking# yet stays SHIPMENT (it's a real
 * booking gaining its identity later); an invoice/customs/other email with no id becomes a DOCUMENT.
 */
const IDENTITY_FIELDS = ['booking_no', 'so_no', 'hbl_awb_fcr_no', 'mbl', 'container_no'] as const
const LIFECYCLE_TYPES = new Set(['Booking Request', 'SO', 'Draft B/L', 'Final B/L', 'Telex Release'])
export function classifyKind(emailTypes: Set<string>, fields: Record<string, unknown>): 'SHIPMENT' | 'DOCUMENT' {
  const hasIdentity = IDENTITY_FIELDS.some((k) => has(fields[k]))
  const hasLifecycle = [...emailTypes].some((t) => LIFECYCLE_TYPES.has(t))
  return !hasIdentity && !hasLifecycle ? 'DOCUMENT' : 'SHIPMENT'
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
