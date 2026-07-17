/**
 * #166 — build leg reviewReasons for decision ingest without exact-string double-concat.
 *
 * When the agent already sent disposition=review, resolveEmailDisposition returns
 * `reasons: dto.reviewReasons` — concatenating both was copying every gate string twice.
 * Always Set-dedupe (first occurrence wins).
 */
import type { CreateDecisionDto } from './dto'
import type { DispositionResult } from './email-disposition'

export function assembleIngestReviewReasons(
  dto: CreateDecisionDto,
  disp: DispositionResult,
): string[] {
  const base = [...(dto.reviewReasons ?? [])]
  const seen = new Set(base)
  // Only add disposition reasons that are not already present (lookup escalations, etc.).
  // When disp.reasons === dto.reviewReasons this adds nothing — fixes the double-concat bug.
  if (disp.disposition === 'review') {
    for (const r of disp.reasons) {
      if (!r || seen.has(r)) continue
      seen.add(r)
      base.push(r)
    }
  }
  for (const r of dto.opsNotes ?? []) {
    if (!r || seen.has(r)) continue
    seen.add(r)
    base.push(r)
  }
  return base
}
