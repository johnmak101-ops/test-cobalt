/** Agent criticReview payload — mirrors backend / cobalt-queue (Phase 1-UI advisory). */

export type Band = 'low' | 'medium' | 'high'

export interface CriticConflict {
  field: string
  label: string
  candidates: { value: string; source: string; confidence?: Band }[]
  rationale: string
}

/** Closed-set multi-candidate legs from queue matcher (#129). */
export interface MatchAmbiguityCandidate {
  shipmentId: string
  jobNo?: string | null
  matchedBy?: 'strong_key' | 'po' | 'unknown'
  overlap?: Record<string, unknown>
  booking_no?: string | null
  so_no?: string | null
  hbl_awb_fcr_no?: string | null
  mbl?: string | null
  container_no?: string | null
  mode?: string | null
  pos?: string[]
  etd?: string | null
  eta?: string | null
  vesselOrFlight?: string | null
  customerLabel?: string | null
}

export interface MatchAmbiguity {
  kind?: 'multi_candidate'
  emailKey?: Record<string, string>
  candidates: MatchAmbiguityCandidate[]
  candidateCount?: number
  truncated?: boolean
  sharedContainer?: string | null
  suggestion?: {
    shipmentId: string
    score?: number
    rationale?: string
    cannotDecide?: boolean
    source?: string
  } | null
}

export interface CriticReview {
  confidence: { score: number; band: Band; label: string }
  summary: string
  observations: string[]
  priorState: { headline: string; fields: unknown[] }
  proposedChanges: unknown[]
  riskFlags: { code: string; severity: Band; message: string }[]
  conflicts?: CriticConflict[]
  recommendedHumanAction: string
  reasons: string[]
  /** #129: email matched ≥2 existing legs — pick among known IDs */
  matchAmbiguity?: MatchAmbiguity
  /** Desk membership shadow marker from queue */
  wouldBeAuto?: boolean
  deskAuto?: boolean
  masterMisses?: { type: string; rawName: string; field: string }[]
}

/** Queue-safe projection — band/summary/topConflictType only (never raw confidence score). */
export interface CriticReviewCompact {
  band: Band
  summary: string
  topConflictType: string
  wouldBeAuto?: boolean
  candidateCount?: number
}

const BAND_LABELS: Record<Band, 'Low' | 'Medium' | 'High'> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

export function bandLabel(band: Band): 'Low' | 'Medium' | 'High' {
  return BAND_LABELS[band]
}

/** Collapsed AI comment line for queue/detail chips — band + short conflict type. */
export function aiCommentLine(compact: CriticReviewCompact): string {
  return `${bandLabel(compact.band)} · ${compact.topConflictType}`
}
