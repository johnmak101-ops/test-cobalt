/**
 * Pure Pillar-4 rule logic (testable, no DB). A rule reads:
 *   "{threshold_hours} {after|before} the {reference}; if {watch_for} is still missing → fire".
 * Optional rule.state gates to the matching shipment staircase state.
 * NOTE: compute_tz='vessel' (A2/A3) is computed in UTC for the POC — a port→timezone map is a
 * later refinement; alert thresholds are coarse (hours/days) so the margin is small.
 */
export interface Rule {
  id: string
  /** When set, leg must be in this staircase state for the rule to apply. */
  state?: string | null
  triggerType: 'days_after' | 'days_before'
  /** booking_request | cutoff | departure | warehouse_in | final_bl | etd | draft_bl | eta */
  triggerReference: string
  /** so | draft_bl | final_bl | telex | sailed | invoice | delivered */
  watchFor: string
  thresholdHours: number // default fallback (hours)
  countryThresholds?: Record<string, number> | null // per-origin-country hour overrides (CN/BD/KH)
  severity: string
  enabled: boolean
}

export interface LegFacts {
  state: string
  originCountry: string | null
  bookingRequestAt: Date | null
  cfsCutoff: Date | null
  atd: Date | null
  etd: Date | null
  eta: Date | null
  warehouseInAt: Date | null
  draftBlAt: Date | null
  finalBlAt: Date | null
  has: {
    so: boolean
    draftBl: boolean
    finalBl: boolean
    telex: boolean
    invoice: boolean
    sailed: boolean
    delivered: boolean
  }
}

export function referenceTime(rule: Rule, f: LegFacts): Date | null {
  switch (rule.triggerReference) {
    case 'booking_request':
      return f.bookingRequestAt
    case 'cutoff':
      return f.cfsCutoff
    case 'departure':
      return f.atd
    case 'warehouse_in':
      return f.warehouseInAt
    case 'final_bl':
      return f.finalBlAt
    case 'draft_bl':
      return f.draftBlAt
    case 'etd':
      return f.etd
    case 'eta':
      return f.eta
    default:
      return null
  }
}

export function watchMet(watchFor: string, f: LegFacts): boolean {
  switch (watchFor) {
    case 'so':
      return f.has.so
    case 'draft_bl':
      return f.has.draftBl
    case 'final_bl':
      return f.has.finalBl
    case 'telex':
      return f.has.telex
    case 'invoice':
      return f.has.invoice
    case 'sailed':
      return f.has.sailed
    case 'delivered':
      return f.has.delivered
    default:
      return false
  }
}

/** The effective threshold (hours) for an origin country: a per-country override if one exists
 *  (checked by KEY PRESENCE so an explicit 0 is honoured), else the rule's default thresholdHours. */
export function resolveThresholdHours(rule: Rule, originCountry: string | null): number {
  if (originCountry && rule.countryThresholds && originCountry in rule.countryThresholds) {
    return rule.countryThresholds[originCountry]
  }
  return rule.thresholdHours
}

export function deadline(rule: Rule, ref: Date, originCountry: string | null): Date {
  const ms = resolveThresholdHours(rule, originCountry) * 3_600_000
  return rule.triggerType === 'days_before' ? new Date(ref.getTime() - ms) : new Date(ref.getTime() + ms)
}

/** True when the rule should raise an alert for these facts at `now`. */
export function isFiring(rule: Rule, f: LegFacts, now: Date): boolean {
  if (!rule.enabled) return false
  // POC: only fire when the leg is in the rule's staircase state (if configured).
  if (rule.state && f.state !== rule.state) return false
  const ref = referenceTime(rule, f)
  if (!ref) return false // anchor not reached → not applicable yet
  if (watchMet(rule.watchFor, f)) return false // the awaited thing arrived → no alert
  return now.getTime() > deadline(rule, ref, f.originCountry).getTime()
}

// ---- Flexible operator message (threshold rules A1–A6) ----

const WATCH_LABELS: Record<string, string> = {
  so: 'SO / booking confirmation',
  draft_bl: 'Draft B/L',
  final_bl: 'Final B/L',
  telex: 'telex release',
  invoice: 'invoice',
  sailed: 'sailing confirmation',
  delivered: 'delivery / in-DC',
}

const REF_LABELS: Record<string, string> = {
  booking_request: 'booking request',
  cutoff: 'CFS cut-off',
  departure: 'ATD',
  warehouse_in: 'warehouse-in',
  final_bl: 'Final B/L receipt',
  draft_bl: 'Draft B/L receipt',
  etd: 'ETD',
  eta: 'ETA',
}

/** Next-step hint derived from what is still missing — not from rule id. */
const ACTION_BY_WATCH: Record<string, string> = {
  so: 'Contact forwarder for SO / booking confirmation',
  draft_bl: 'Contact forwarder for Draft B/L',
  final_bl: 'Chase Final B/L with forwarder',
  telex: 'Confirm freight payment / telex release',
  invoice: 'Chase commercial invoice with forwarder',
  sailed: 'Confirm sailing with forwarder',
  delivered: 'Confirm delivery / in-DC with consignee',
}

/** Configured threshold: exact hours, or whole days when divisible by 24. */
function formatDurationHours(hours: number): string {
  const abs = Math.abs(hours)
  if (abs % 24 === 0) {
    const days = abs / 24
    return days === 1 ? '1 day' : `${days} days`
  }
  return abs === 1 ? '1 hour' : `${abs} hours`
}

/** Elapsed time for operators: prefer calendar-day granularity once past a day. */
function formatElapsedHours(hours: number): string {
  const abs = Math.max(0, Math.floor(Math.abs(hours)))
  if (abs < 24) return formatDurationHours(abs || 0)
  const days = Math.floor(abs / 24)
  return days === 1 ? '1 day' : `${days} days`
}

function dayStamp(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Build a live operator message from the rule shape + leg facts (not the static DB description).
 * Threshold, reference date, elapsed window, and next-step action all come from configuration.
 * Safe to call only when the rule is firing (reference present, watch still missing).
 */
export function formatThresholdAlertMessage(rule: Rule, f: LegFacts, now: Date): string {
  const watch = WATCH_LABELS[rule.watchFor] ?? rule.watchFor
  const refLabel = REF_LABELS[rule.triggerReference] ?? rule.triggerReference
  const hours = resolveThresholdHours(rule, f.originCountry)
  const thresholdPhrase = formatDurationHours(hours)
  const ref = referenceTime(rule, f)
  const action = ACTION_BY_WATCH[rule.watchFor]
  const actionSuffix = action ? ` ${action}.` : ''

  if (!ref) {
    return `No ${watch} received — threshold ${thresholdPhrase} relative to ${refLabel}.${actionSuffix}`
  }

  const refDay = dayStamp(ref)
  if (rule.triggerType === 'days_before') {
    // Window is "within N of the anchor"; message focuses on the upcoming/passed anchor.
    return (
      `No ${watch} — ${refLabel} is ${refDay} (alert window: ${thresholdPhrase} before).` +
      actionSuffix
    )
  }

  // days_after: how long past the anchor, and the configured threshold.
  const elapsedHours = Math.max(0, (now.getTime() - ref.getTime()) / 3_600_000)
  const elapsedPhrase = formatElapsedHours(elapsedHours > 0 ? elapsedHours : hours)
  return (
    `No ${watch} — ${elapsedPhrase} after ${refLabel} (${refDay}); threshold is ${refLabel} + ${thresholdPhrase}.` +
    actionSuffix
  )
}

// ---- A7 (built-in): requested cargo-ready revision not reflected ----

export interface CrdStatement {
  receivedAt: Date | null
  crd: Date | string | null
}

export interface CrdRevisionFinding {
  requested: Date
  current: Date
}

const dayOf = (d: Date): string => d.toISOString().slice(0, 10)

/**
 * "Please revise the delivery date of these 8 bookings to July 08th" — an email asks for a LATER
 * cargo-ready date, but a NEWER booking document still shows the earlier one (the platform hasn't
 * been revised). Date fields merge latest-received-wins, so the tracker honestly shows the old date —
 * this check surfaces the gap instead of silently living with it.
 *
 * Fires when the latest-dated request (max CRD value) is later than BOTH the newest statement's CRD
 * and the tracked value, AND the request is recent relative to the newest statement (windowHours) —
 * an old obsolete later-date never flags a legitimate schedule pull-forward.
 */
export function crdRevisionNotReflected(
  statements: CrdStatement[],
  trackedCrd: Date | null,
  windowHours = 72,
): CrdRevisionFinding | null {
  if (!trackedCrd) return null
  const dated = statements
    .map((s) => ({
      at: s.receivedAt ? s.receivedAt.getTime() : 0,
      crd: s.crd instanceof Date ? s.crd : s.crd ? new Date(s.crd) : null,
    }))
    .filter((s): s is { at: number; crd: Date } => !!s.crd && !Number.isNaN(s.crd.getTime()))
  if (dated.length < 2) return null

  const newest = dated.reduce((a, b) => (b.at > a.at ? b : a))
  const requested = dated.reduce((a, b) => (dayOf(b.crd) > dayOf(a.crd) ? b : a))
  if (dayOf(requested.crd) <= dayOf(newest.crd)) return null // newest doc already reflects (or exceeds) it
  if (dayOf(requested.crd) <= dayOf(trackedCrd)) return null
  if (requested.at < newest.at - windowHours * 3_600_000) return null // stale later-date = obsolete, not a request
  return { requested: requested.crd, current: trackedCrd }
}
