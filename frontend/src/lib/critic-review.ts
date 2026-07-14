/** Agent criticReview payload — mirrors backend / cobalt-queue (Phase 1-UI advisory). */

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

/** Queue-safe projection — band/summary/topConflictType only (never raw confidence score). */
export interface CriticReviewCompact {
  band: Band
  summary: string
  topConflictType: string
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
