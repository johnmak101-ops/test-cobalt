/**
 * Pure Pillar-4 rule logic (testable, no DB). A rule reads:
 *   "{threshold_hours} {after|before} the {reference}; if {watch_for} is still missing → fire".
 * NOTE: compute_tz='vessel' (A2/A3) is computed in UTC for the POC — a port→timezone map is a
 * later refinement; alert thresholds are coarse (hours/days) so the margin is small.
 */
export interface Rule {
  id: string
  triggerType: 'days_after' | 'days_before'
  triggerReference: string // booking_request | cutoff | departure | warehouse_in | final_bl
  watchFor: string // so | draft_bl | final_bl | telex | sailed | invoice
  thresholdHours: number
  severity: string
  enabled: boolean
}

export interface LegFacts {
  state: string
  bookingRequestAt: Date | null
  cfsCutoff: Date | null
  atd: Date | null
  warehouseInAt: Date | null
  finalBlAt: Date | null
  has: { so: boolean; draftBl: boolean; finalBl: boolean; telex: boolean; invoice: boolean; sailed: boolean }
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
    default:
      return false
  }
}

export function deadline(rule: Rule, ref: Date): Date {
  const ms = rule.thresholdHours * 3_600_000
  return rule.triggerType === 'days_before' ? new Date(ref.getTime() - ms) : new Date(ref.getTime() + ms)
}

/** True when the rule should raise an alert for these facts at `now`. */
export function isFiring(rule: Rule, f: LegFacts, now: Date): boolean {
  if (!rule.enabled) return false
  const ref = referenceTime(rule, f)
  if (!ref) return false // anchor not reached → not applicable yet
  if (watchMet(rule.watchFor, f)) return false // the awaited thing arrived → no alert
  return now.getTime() > deadline(rule, ref).getTime()
}
