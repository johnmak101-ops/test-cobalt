/**
 * Confidence for the LEGACY reconcile path (manual POST /reconcile/run), which routes on confidence vs the
 * threshold — it has NO deterministic review gate of its own.
 *
 * DIVERGENCE (intentional, by design): the AGENT path no longer works this way. There the deterministic
 * review gate is authoritative (autoApply → confirmed/provisional) and the Critic is an informational
 * anomaly score that does NOT penalise incompleteness (PO-only / no strong id / sparse are normal lifecycle).
 * This legacy path still applies those completeness penalties, so a manual rebuild is deliberately MORE
 * CONSERVATIVE (more provisional) than the agent — the safe direction. It can re-provisionalize a leg the
 * agent auto-confirmed; that is acceptable for a manual admin rebuild. Unifying the two onto one gate is a
 * follow-up (it would require porting the gate's customer/identity checks here, which this path lacks).
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
