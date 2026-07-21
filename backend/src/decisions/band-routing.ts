import type { CriticReview } from './critic-review.types'

/** Mirror cobalt-queue HARD_STOP_CODES — hard stops never auto-confirm under band routing. */
export const HARD_STOP_RISK_CODES = new Set([
  'INTRA_EMAIL_MULTI_STRONG_ID',
  'AMBIGUOUS_MATCH',
  'BACKEND_CONFLICT',
  'PO_REASSIGN',
  'PORTAL_ECHO',
])

export type ReviewStatus = 'confirmed' | 'provisional' | 'skip'

export function mapRecommendedToStatus(r: 'auto' | 'review' | 'skip' | undefined): ReviewStatus {
  if (r === 'auto') return 'confirmed'
  if (r === 'skip') return 'skip'
  return 'provisional'
}

/** Derive queue-style recommendedRouting from critic only (when DTO omits recommendedRouting). */
export function deriveRecommendedFromCritic(
  critic: CriticReview | null | undefined,
): 'auto' | 'review' | 'skip' | null {
  if (!critic) return null
  if (critic.confidence?.band === 'high' && !hasHardStopFlags(critic)) return 'auto'
  return 'review'
}

export function hasHardStopFlags(critic: CriticReview | null | undefined): boolean {
  if (!critic?.riskFlags?.length) return false
  return critic.riskFlags.some((f) => HARD_STOP_RISK_CODES.has(f.code))
}

/**
 * High confidence without hard-stop risk flags: auto-confirm and hide from Review Queue
 * (Active + Approved). Hard-stop high still needs a human look.
 */
export function isHighBandAutoEligible(critic: CriticReview | null | undefined): boolean {
  return critic?.confidence?.band === 'high' && !hasHardStopFlags(critic)
}

/**
 * Band-routing reviewStatus from queue recommendedRouting (preferred) or critic band fallback.
 * Returns null when band routing is N/A (no critic and no recommendedRouting).
 */
export function resolveBandRouting(opts: {
  recommendedRouting?: 'auto' | 'review' | 'skip'
  criticReview?: CriticReview | null
  /** when true, force provisional even if recommended auto (e.g. cancel) */
  forceProvisional?: boolean
}): ReviewStatus | null {
  const rec = opts.recommendedRouting
  let status: ReviewStatus | null = null

  if (rec === 'skip') {
    status = 'skip'
  } else if (rec === 'auto' || rec === 'review') {
    status = mapRecommendedToStatus(rec)
    if (status === 'confirmed' && hasHardStopFlags(opts.criticReview)) status = 'provisional'
  } else {
    const c = opts.criticReview
    if (!c) return null
    status = c.confidence?.band === 'high' && !hasHardStopFlags(c) ? 'confirmed' : 'provisional'
  }

  if (opts.forceProvisional && status !== null && status !== 'skip') {
    return 'provisional'
  }
  return status
}
