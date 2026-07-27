/** Agent criticReview payload — mirrors backend / cobalt-queue (Phase 1-UI advisory). */

export type Band = 'low' | 'medium' | 'high'

/**
 * `source` on a candidate the backend synthesised from MASTER DATA rather than from an email
 * (presentation/party-mismatch-conflict.ts — the raw party twin disagreeing with its resolved
 * master). Keep the literal in step with that module: the desk words its question differently for
 * these, because "the email proposes…" is simply untrue of a row no email ever stated.
 */
export const MASTER_DATA_SOURCE = 'Master data'

export function isMasterDataSource(source: string | null | undefined): boolean {
  return String(source ?? '').trim().toLowerCase() === MASTER_DATA_SOURCE.toLowerCase()
}

export interface CriticConflict {
  field: string
  label: string
  candidates: {
    value: string
    source: string
    confidence?: Band
    /** graphMessageId of the email that stated this value (queue-side attribution). Matched against
     *  a related email's graphMessageId to open the exact source — absent when the queue could not
     *  attribute it (e.g. the 'System' side of a backend mismatch), and never guessed. */
    sourceEmailId?: string | null
    /** Response-time Mesh master attachment (party fields only): object = resolved (code chip),
     *  null = letter-bearing name not in the Mesh mirror ("not in Mesh" tag), absent = no claim. */
    master?: { code: string; name: string } | null
  }[]
  rationale: string
}

/** One conflict candidate — the shape ConflictRow renders. */
export type CriticCandidate = CriticConflict['candidates'][number]

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
  /**
   * Candidates the queue offered that ShipTrack's committer would refuse to amend — each states a
   * different value for an identity type the email also states, so it is a different shipment.
   * Attached on read by the backend (shipments/candidate-reconcile.ts).
   */
  refusedCandidates?: { shipmentId: string; onKey: string; emailValue: string; candidateValue: string }[]
  /** Desk membership shadow marker from queue */
  wouldBeAuto?: boolean
  deskAuto?: boolean
  masterMisses?: { type: string; rawName: string; field: string }[]
  /** Hybrid-C: multi-booking fan-out shortfall */
  splitAudit?: { expected: number; actual: number }
  /** Hybrid-C: which booking row this decision is within a multi-booking email */
  multiBookingOrigin?: { index: number; total: number; bookingNo?: string }
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
