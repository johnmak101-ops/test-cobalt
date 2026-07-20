/**
 * Decision phrase for Review queue rows / card headline.
 * English-only product UI (ops copy pass). Traditional Chinese is reserved for
 * multi-leg / 拼櫃 (shared container) elsewhere — not decision phrases.
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
    return `Pick the right shipment (${i.candidates} candidates)`
  }
  if (i.weakIdentity) return 'Confirm this is a real shipment'
  if (i.criticalBlanks) {
    return `Fill ${i.criticalBlanks} critical blank${i.criticalBlanks > 1 ? 's' : ''}`
  }
  if (i.conflictField) return `Resolve ${i.conflictField} conflict`
  const g = i.gateCodes?.find((c) => GATE_PHRASE[c])
  if (g) return GATE_PHRASE[g]!
  if (i.aiLowReason) return 'Verify extraction (AI low confidence)'
  return null
}
