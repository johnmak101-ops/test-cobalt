/**
 * #173 Phase A′ — human pick telemetry for multi-candidate match.
 * Appends JSONL under AMBIGUITY_PICK_DIR or data/ambiguity/picks-YYYY-MM-DD.jsonl.
 * Never throws into the review path.
 */
import { appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

export type AmbiguityPickEvent = {
  type: 'human_pick'
  ts: string
  humanChoice: string
  suggestionShipmentId: string | null
  suggestionSource: string | null
  suggestionDisplayPosition: number | null
  agreedWithSuggestion: boolean | null
  candidateIds: string[]
  emailKey: Record<string, string>
  decisionRef: string | null
  sourceShipmentId: string
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10)
}

function pickDir(): string {
  const override = process.env.AMBIGUITY_PICK_DIR?.trim()
  const dir = override
    ? resolve(override)
    : resolve(process.cwd(), 'data', 'ambiguity')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function recordAmbiguityPick(ev: Omit<AmbiguityPickEvent, 'type' | 'ts'>): void {
  if (process.env.AMBIGUITY_PICK_JSONL === '0' || process.env.AMBIGUITY_PICK_JSONL === 'false') return
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') return
  try {
    const path = resolve(pickDir(), `picks-${utcDay()}.jsonl`)
    const row: AmbiguityPickEvent = { type: 'human_pick', ts: new Date().toISOString(), ...ev }
    appendFileSync(path, `${JSON.stringify(row)}\n`, 'utf8')
    console.info(
      `[ambiguity-pick] source=${ev.sourceShipmentId} choice=${ev.humanChoice} sug=${ev.suggestionShipmentId ?? '-'} ` +
        `${ev.agreedWithSuggestion === true ? 'agree' : ev.agreedWithSuggestion === false ? 'disagree' : 'n/a'}`,
    )
  } catch (err) {
    console.warn(`[ambiguity-pick] write failed: ${String(err).slice(0, 120)}`)
  }
}

/** Extract pick fields from a provisional leg's criticReview.matchAmbiguity. */
export function pickContextFromLeg(leg: {
  id: string
  criticReview?: unknown
  matchKeys?: unknown
}): {
  candidateIds: string[]
  suggestionShipmentId: string | null
  suggestionSource: string | null
  suggestionDisplayPosition: number | null
  emailKey: Record<string, string>
  decisionRef: string | null
} | null {
  const cr = leg.criticReview as {
    matchAmbiguity?: {
      candidates?: { shipmentId: string }[]
      suggestion?: { shipmentId: string; source?: string }
      llmSuggestion?: { shipmentId: string; source?: string }
      emailKey?: Record<string, string>
      candidateCount?: number
    }
  } | null
  const ma = cr?.matchAmbiguity
  if (!ma?.candidates || ma.candidates.length < 2) return null
  const ids = ma.candidates.map((c) => c.shipmentId)
  const sug = ma.suggestion ?? ma.llmSuggestion ?? null
  const pos = sug ? ids.indexOf(sug.shipmentId) : -1
  return {
    candidateIds: ids,
    suggestionShipmentId: sug?.shipmentId ?? null,
    suggestionSource: sug?.source ?? null,
    suggestionDisplayPosition: pos >= 0 ? pos : null,
    emailKey: ma.emailKey ?? {},
    decisionRef: leg.id,
  }
}
