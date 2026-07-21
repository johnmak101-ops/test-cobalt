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
  // AT_WAREHOUSE = cargo is (or was) receiving at CFS/warehouse — NOT a planned future open date,
  // and never ex-factory/cargo_ready (those stay on cargo_ready_date and must not promote state).
  // Draft B/L is a document-stage fallback. A warehouse_start_date only counts once the window has
  // started (date ≤ today); a future CY/CFS open on a booking form is schedule only.
  if (emailTypes.has('Draft B/L')) bump('AT_WAREHOUSE')
  if (has(fields.warehouse_start_date)) {
    const day = String(fields.warehouse_start_date).slice(0, 10)
    const wsMs = Date.parse(`${day}T00:00:00Z`)
    if (!Number.isNaN(wsMs) && wsMs <= now.getTime()) bump('AT_WAREHOUSE')
  }
  // Departure (SAILED): ATD field, Departure Notice email type (On-board / Departure date / ATD keywords),
  // or Invoice/Billing post-sail path below.
  if (has(fields.atd) || emailTypes.has('Departure Notice')) bump('SAILED')
  // BUG 7: an Invoice/Billing shipment carrying a cut carrier document (MBL, or the house HBL/AWB/FCR — the
  // carrier number often lands there, not in mbl) with a PAST ETD has demonstrably sailed even without an
  // explicit ATD (invoices are issued post-departure). Tightly gated to that exact combination — still
  // Invoice/Billing + past ETD, NOT a broad has(carrier-doc)->SAILED nor vessel+past-etd->SAILED, both of
  // which false-promote drafts / booking-requests.
  if (emailTypes.has('Invoice/Billing') && (has(fields.mbl) || has(fields.hbl_awb_fcr_no)) && has(fields.etd)) {
    const etd = new Date(String(fields.etd))
    if (!Number.isNaN(etd.getTime()) && etd.getTime() < now.getTime()) bump('SAILED')
  }
  // Final BOL / Telex (RELEASED): Final B/L, Telex Release (incl. Surrendered / Original BOL classified upstream)
  if (emailTypes.has('Telex Release') || emailTypes.has('Final B/L')) bump('RELEASED')
  // Delivered: in-DC date + departure signal, OR ETD calendar day equals today (ops rule).
  if (has(fields.in_dc_date) && (has(fields.atd) || emailTypes.has('Final B/L') || emailTypes.has('Telex Release') || emailTypes.has('Departure Notice'))) {
    bump('DELIVERED')
  }
  if (has(fields.etd)) {
    const etdDay = String(fields.etd).slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(etdDay)) {
      const y = now.getUTCFullYear()
      const m = String(now.getUTCMonth() + 1).padStart(2, '0')
      const d = String(now.getUTCDate()).padStart(2, '0')
      const today = `${y}-${m}-${d}`
      if (etdDay === today) bump('DELIVERED')
    }
  }
  return s
}

/**
 * Split a committed leg into SHIPMENT vs DOCUMENT (Unlinked Documents inbox).
 *
 * DOCUMENT is reserved for **Invoice/Billing only without a clear booking number** — vendor invoices /
 * debit notes parked until a human links them. Clear bookings mis-typed as Invoice stay SHIPMENT.
 *
 * Review-only rules (kind stays SHIPMENT; committer may flag provisional):
 *   (a) bare_orphan — no identity + no lifecycle email type (ack/cancel/status with only a PO, etc.)
 *   (b) invoice_with_booking — Invoice/Billing-only but booking_no present (do not park as DOCUMENT)
 *   (c) platform_only — CVP/TradeLink portal mail without carrier identity (LPO-as-booking risk)
 *
 * A genuine SO *document* email type is lifecycle → SHIPMENT. Mixed types that include Invoice/Billing
 * plus a lifecycle type (Booking/SO/B/L) stay SHIPMENT.
 *
 * Invoice-only with SO/HBL/container but **no** booking_no still → DOCUMENT (finance invoice citing SO).
 */
const IDENTITY_FIELDS = ['booking_no', 'so_no', 'hbl_awb_fcr_no', 'mbl', 'container_no'] as const
/** Carrier-issued identities — booking_no EXCLUDED (the portal leaks an LPO into it, see (c)). */
const CARRIER_IDENTITY = ['hbl_awb_fcr_no', 'mbl', 'container_no'] as const
const LIFECYCLE_TYPES = new Set([
  'Booking Request',
  'SO',
  'Draft B/L',
  'Final B/L',
  'Telex Release',
  'Departure Notice',
])
/**
 * Classification rule:
 *   invoice_so_ref → DOCUMENT (Invoice/Billing-only, no booking_no)
 *   invoice_with_booking → SHIPMENT + review flag (Invoice-only but has booking_no)
 *   bare_orphan / platform_only → SHIPMENT + optional review flag
 */
export type ClassifyRule = 'bare_orphan' | 'invoice_so_ref' | 'invoice_with_booking' | 'platform_only'

export function classifyKindDetail(
  emailTypes: Set<string>,
  fields: Record<string, unknown>,
  opts: { fromPlatform?: boolean } = {},
): { kind: 'SHIPMENT' | 'DOCUMENT'; rule: ClassifyRule | null } {
  const invoiceOnly = emailTypes.size > 0 && [...emailTypes].every((t) => t === 'Invoice/Billing')
  // Unlinked Documents = Invoice/Billing only — unless a clear booking_no is present (ops 2026-07-17)
  if (invoiceOnly) {
    if (has(fields.booking_no)) return { kind: 'SHIPMENT', rule: 'invoice_with_booking' }
    return { kind: 'DOCUMENT', rule: 'invoice_so_ref' }
  }

  const hasIdentity = IDENTITY_FIELDS.some((k) => has(fields[k]))
  const hasLifecycle = [...emailTypes].some((t) => LIFECYCLE_TYPES.has(t))
  // Bare orphan (Other/ack/cancel with no booking/SO/HBL): SHIPMENT, not Document
  if (!hasIdentity && !hasLifecycle) return { kind: 'SHIPMENT', rule: 'bare_orphan' }

  const hasCarrierIdentity = CARRIER_IDENTITY.some((k) => has(fields[k]))
  // Platform portal-only without carrier id — flag, keep SHIPMENT
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
  'Departure Notice': 'SAILED',
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
