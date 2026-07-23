/** Derive the unified 6-state staircase from the signals present (highest reached wins). */

const ORDER = ['BOOKED', 'CONFIRMED', 'AT_WAREHOUSE', 'SAILED', 'RELEASED', 'DELIVERED'] as const
export type ShipmentState = (typeof ORDER)[number]

/**
 * Position on the staircase; -1 for anything unrecognised. Lets a caller compare two states without
 * copying ORDER — the state refresher uses it to promote only, never to walk a leg backwards.
 * An unknown stored value ranks -1, so it can be climbed out of but never descended into.
 */
export function stateRank(state: string | null | undefined): number {
  return ORDER.indexOf(state as ShipmentState)
}

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
  // Final BOL (SAILED) — the DOCUMENT stage, badge label "Final BOL" (see Badge.tsx statusLabels and
  // po-progress.ts: a cut B/L is paperwork, the goods have not necessarily moved). Final B/L, Telex
  // Release, Surrendered / Original BOL — all classified into these two types upstream by the parser.
  if (emailTypes.has('Final B/L') || emailTypes.has('Telex Release')) bump('SAILED')

  // Departure (RELEASED) — the goods physically left, badge label "Departure". ATD field, or a Departure
  // Notice email (On-board / Departure date / ATD keywords, resolved upstream).
  const departed =
    has(fields.atd) ||
    emailTypes.has('Departure Notice') ||
    // BUG 7: an Invoice/Billing shipment carrying a cut carrier document (MBL, or the house HBL/AWB/FCR — the
    // carrier number often lands there, not in mbl) with a PAST ETD has demonstrably sailed even without an
    // explicit ATD (invoices are issued post-departure). Tightly gated to that exact combination — still
    // Invoice/Billing + past ETD, NOT a broad has(carrier-doc)->departed nor vessel+past-etd->departed, both
    // of which false-promote drafts / booking-requests.
    (emailTypes.has('Invoice/Billing') &&
      (has(fields.mbl) || has(fields.hbl_awb_fcr_no)) &&
      has(fields.etd) &&
      isPast(fields.etd, now))
  if (departed) bump('RELEASED')

  // Delivered (ARRIVED) — arrival evidence only. A DEPARTURE date (etd/atd) is never delivery evidence:
  // a 30-day ocean leg would otherwise read "Delivered" on the day it sailed.
  //   1. ATA — the actual arrival, strongest signal (the arrival-side twin of ATD).
  //   2. in-DC date + departure evidence — physically received at the DC.
  //   3. ETA that has PASSED + departure evidence — the estimated fallback. `<= today`, not `== today`:
  //      state is derived when an email is committed, so an equality test silently misses any shipment
  //      with no mail that day. Requires departure evidence — an estimate cannot outrank never leaving.
  if (has(fields.ata)) bump('DELIVERED')
  if (has(fields.in_dc_date) && departed) bump('DELIVERED')
  if (departed && has(fields.eta) && isPastOrToday(fields.eta, now)) bump('DELIVERED')
  return s
}

/** Calendar-day compare of a parsed date field against `now` (UTC day granularity). */
function dayOf(value: unknown): string | null {
  const day = String(value).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

function todayUtc(now: Date): string {
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  return `${now.getUTCFullYear()}-${m}-${d}`
}

function isPast(value: unknown, now: Date): boolean {
  const t = new Date(String(value)).getTime()
  return !Number.isNaN(t) && t < now.getTime()
}

function isPastOrToday(value: unknown, now: Date): boolean {
  const day = dayOf(value)
  return day != null && day <= todayUtc(now)
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
