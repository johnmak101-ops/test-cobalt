/**
 * Confidence for the LEGACY reconcile path (manual POST /reconcile/run). It mirrors the agent's
 * heuristic Critic (cobalt-queue/src/critic-agent/heuristic.ts) so a manual rebuild routes through
 * the SAME review gate as the agent decisions — no more blanket-`confirmed` legs that skip review.
 *
 * NOTE: until the merge policy is de-duplicated (it currently lives in two places), this path's
 * `conflicts` still include lifecycle supersedes, so it scores conservatively (more provisional).
 * That is the safe direction; agent decisions already score on genuine-only conflicts.
 */
const STRONG = ['so_no', 'booking_no', 'hbl_awb_fcr_no', 'mbl', 'container_no']
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

export interface ScoreInput {
  conflicts: string[]
  pos: string[]
  fields: Record<string, unknown>
  matchKeys: Record<string, unknown>
}

export function scoreReconGroup({ conflicts, pos, fields, matchKeys }: ScoreInput): { confidence: number; reasons: string[] } {
  let confidence = 100
  const reasons: string[] = []
  if (conflicts.length) {
    confidence -= Math.min(40, 25 * conflicts.length)
    reasons.push(`${conflicts.length} unresolved conflict(s)`)
  }
  if (!STRONG.some((k) => matchKeys[k])) {
    confidence -= 30
    reasons.push('no strong identity key (PO-only match)')
  }
  if (!pos.length) {
    confidence -= 20
    reasons.push('no PO')
  }
  const fieldCount = Object.values(fields).filter((v) => v != null && v !== '').length
  if (fieldCount < 2) {
    confidence -= 15
    reasons.push('sparse fields')
  }
  return { confidence: clamp(confidence), reasons }
}
