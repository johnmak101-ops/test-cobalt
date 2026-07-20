/** Agent criticReview payload — mirror cobalt-queue shape loosely (Phase 1-UI advisory). */

export type Band = 'low' | 'medium' | 'high'

export interface CriticConflict {
  field: string
  label: string
  candidates: { value: string; source: string; confidence?: Band }[]
  rationale: string
}

/** Closed-set multi-candidate leg from queue matcher (#129). */
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

/** Structured Mesh miss from queue (criticReview.masterMisses). */
export interface MasterMiss {
  type: 'vendor' | 'forwarder' | 'customer'
  rawName: string
  field: string
}

/** casefold + trim + collapse internal whitespace — MUST match cobalt-queue. */
export function normalizeMasterName(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, ' ')
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
  /** #129 closed-set candidates when email matched ≥2 legs */
  matchAmbiguity?: MatchAmbiguity
  /** Desk membership shadow: queue would auto-commit if OPENPAVE_DESK_MEMBERSHIP=on */
  wouldBeAuto?: boolean
  /** On-mode desk flip (audit; never wire-identical to a clean gate auto) */
  deskAuto?: boolean
  /** Structured Mesh admin worklist entries (nested under criticReview only) */
  masterMisses?: MasterMiss[]
}
