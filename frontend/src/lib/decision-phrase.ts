/**
 * Decision phrase for Review queue rows / card headline.
 * Copy strings are draft (spec §11 open item) — keep ALL phrases in this file for ops copy pass.
 */
export interface PhraseInput {
  candidates?: number
  weakIdentity?: boolean
  criticalBlanks?: number
  conflictField?: string | null
  gateCodes?: string[]
  aiLowReason?: boolean
}

export const AI_CONFIDENCE_LOW_REASON = 'AI confidence low — verify extraction'

/** Shared weak-identity reason detector (Review queue + ReviewCard). */
export function isWeakIdentityReason(raw: string): boolean {
  return /no booking|no identity|portal echo|not actionable|thin mail/i.test(raw)
}

const GATE_PHRASE: Record<string, string> = {
  'g-checksum': 'Verify container check digit',
  'g-total': 'Verify line totals vs footer',
  'g-pages': 'Verify totals (pages skipped)',
}

/** Priority: which-shipment → real → blanks → conflict → gate → ai-low. null = use legacy lead. */
export function decisionPhrase(i: PhraseInput): string | null {
  if (i.candidates && i.candidates > 1) {
    return `Pick the right shipment (${i.candidates} candidates) · 揀邊票貨`
  }
  if (i.weakIdentity) return 'Confirm this is a real shipment · 真貨定通知'
  if (i.criticalBlanks) {
    return `Fill ${i.criticalBlanks} critical blank${i.criticalBlanks > 1 ? 's' : ''} · 補關鍵欄位`
  }
  if (i.conflictField) return `Resolve ${i.conflictField} conflict · 解欄位衝突`
  const g = i.gateCodes?.find((c) => GATE_PHRASE[c])
  if (g) return `${GATE_PHRASE[g]} · 驗證 gate`
  if (i.aiLowReason) return 'Verify extraction (AI low confidence) · 驗證拆解'
  return null
}
