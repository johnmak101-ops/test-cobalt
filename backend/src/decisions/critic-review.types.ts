/** Agent criticReview payload — mirror cobalt-queue shape loosely (Phase 1-UI advisory). */

export type Band = 'low' | 'medium' | 'high'

export interface CriticConflict {
  field: string
  label: string
  candidates: {
    value: string
    source: string
    confidence?: Band
    /** Response-time Mesh master attachment (party fields only, hydrate-critic-entity-labels):
     *  object = resolved (code chip), null = letter-bearing value not in the Mesh mirror
     *  ("not in Mesh" tag), absent = no claim (non-party field, numeric leak, or ambiguous name). */
    master?: { code: string; name: string } | null
  }[]
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

/**
 * A "party" carrying no letter in ANY script is not a company — it is a PO / booking / container
 * number that leaked into a party field upstream. The Mesh-miss worklist asks ops to add the name in
 * Mesh, which is unactionable for a bare number, so such misses are excluded from that surface.
 * `\p{L}` keeps CJK names (南海制衣) and letter+digit brands (3M, 7-Eleven).
 * Twin of isNonPartyName in frontend/src/components/review/needs-attention.ts — keep in step.
 */
export function isNonPartyName(raw: string | null | undefined): boolean {
  return !/\p{L}/u.test(String(raw ?? ''))
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
  /**
   * Candidates the QUEUE offered that ShipTrack's committer would refuse to amend — each states a
   * different value for an identity type the email also states, so it is a different shipment
   * (`strongKeysConflict`). Attached on read, never stored: it is a reconciliation between two
   * matchers, and either side can change. See shipments/candidate-reconcile.ts.
   */
  refusedCandidates?: {
    shipmentId: string
    onKey: string
    emailValue: string
    candidateValue: string
  }[]
  /** Desk membership shadow: queue would auto-commit if OPENPAVE_DESK_MEMBERSHIP=on */
  wouldBeAuto?: boolean
  /** On-mode desk flip (audit; never wire-identical to a clean gate auto) */
  deskAuto?: boolean
  /** Structured Mesh admin worklist entries (nested under criticReview only) */
  masterMisses?: MasterMiss[]
  /** Hybrid-C: multi-booking fan-out shortfall (nested; whitelist-safe) */
  splitAudit?: { expected: number; actual: number }
  /** Hybrid-C: which booking row this decision is within a multi-booking email */
  multiBookingOrigin?: { index: number; total: number; bookingNo?: string }
}
