/**
 * Needs attention list for ReviewCard (design 2026-07-17).
 * Non-field decision context only; conflict comparison stays in the table.
 */
import {
  categorizeReason,
  humanizeReasons,
  type ReasonCategory,
} from '../../lib/review-reasons'

/** Mirrors ReviewCard RISK_CODE_CATEGORY — queue risk flags → reason category. */
export const RISK_CODE_CATEGORY: Record<string, ReasonCategory> = {
  INTRA_EMAIL_FIELD_CONFLICT: 'conflict',
  INTRA_EMAIL_CARGO_CONFLICT: 'conflict',
  BACKEND_CONFLICT: 'conflict',
  FIELD_LOCK_CLASH: 'conflict',
  INTRA_EMAIL_MULTI_STRONG_ID: 'multi_id',
  AMBIGUOUS_MATCH: 'multi_id',
  PO_REASSIGN: 'multi_id',
  PO_ONLY_WEAK_MATCH: 'multi_id',
  MULTI_LEG_SUSPECT: 'multi_id',
  MULTI_DESTINATION_SUSPECT: 'multi_id',
  THREAD_SUPERSEDE: 'multi_id',
  WEAK_IDENTITY: 'no_identity',
  PORTAL_ECHO: 'portal',
  PARTY_UNRESOLVED: 'master_miss',
  PARTY_OPS: 'master_miss',
  MISSING_ATTACHMENT: 'extraction',
  EXTRACTION_INCOMPLETE: 'extraction',
  SCAN_OCR_RISK: 'extraction',
  CARGO_SANITY: 'extraction',
}

export type NeedsAttentionItem = {
  key: string
  severity: 'low' | 'medium' | 'high'
  text: string
  category: ReasonCategory
}

const SEV_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 }

/** Hard cap from design: 1–2 lines. */
export const NEEDS_ATTENTION_MAX = 2

/**
 * Build Needs attention bullets: riskFlags + reviewReasons, drop conflict-class when
 * the conflict table or conflict flags already own that story, cap at 2 by severity.
 */
export function buildNeedsAttention(opts: {
  riskFlags?: Array<{ code: string; severity?: string; message?: string }> | null
  reviewReasons?: string[] | null
  conflictsCount: number
  max?: number
}): NeedsAttentionItem[] {
  const max = opts.max ?? NEEDS_ATTENTION_MAX
  const flags = (opts.riskFlags ?? []).filter((f) => f?.message)
  const explained = new Set<ReasonCategory>()
  for (const f of flags) {
    const c = RISK_CODE_CATEGORY[f.code]
    if (c) explained.add(c)
  }
  // Conflict table owns field diffs — hide conflict-class bullets when the table is present.
  // Conflict riskFlags still show when there is no table (one-line heads-up only).
  const tableOwnsConflicts = opts.conflictsCount > 0

  const items: NeedsAttentionItem[] = []

  for (let i = 0; i < flags.length; i++) {
    const f = flags[i]!
    const category = RISK_CODE_CATEGORY[f.code] ?? 'other'
    if (category === 'conflict' && tableOwnsConflicts) continue
    items.push({
      key: `flag-${f.code}-${i}`,
      severity: (f.severity as 'low' | 'medium' | 'high') || 'medium',
      text: f.message!,
      category,
    })
  }

  const reasons = opts.reviewReasons ?? []
  for (const { raw, text } of humanizeReasons(reasons, {
    fieldDetailAvailable: opts.conflictsCount > 0,
  })) {
    const category = categorizeReason(raw)
    // Drop reason if a flag already explains that category, or if conflict table owns field diffs
    if (explained.has(category)) continue
    if (category === 'conflict' && (tableOwnsConflicts || explained.has('conflict'))) continue
    items.push({
      key: `reason-${raw}`,
      severity: 'medium',
      text,
      category,
    })
  }

  // High first, then medium, then low; stable within band
  items.sort((a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0))
  return items.slice(0, max)
}
