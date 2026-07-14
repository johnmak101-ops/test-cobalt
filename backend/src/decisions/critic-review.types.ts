/** Agent criticReview payload — mirror cobalt-queue shape loosely (Phase 1-UI advisory). */

export type Band = 'low' | 'medium' | 'high'

export interface CriticConflict {
  field: string
  label: string
  candidates: { value: string; source: string; confidence?: Band }[]
  rationale: string
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
}
