/**
 * #129 Phase F — log human multi-candidate picks for ranker accuracy (no full email body).
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { CriticReview } from '../decisions/critic-review.types'

export type AmbiguityPickEvent = {
  type: 'human_pick'
  ts: string
  sourceShipmentId: string
  humanChoiceShipmentId: string
  actorId: string
  emailKey?: Record<string, string>
  candidateIds?: string[]
  suggestionShipmentId?: string | null
  suggestionSource?: string | null
  /** true when human picked the same id as suggestion */
  agreedWithSuggestion: boolean | null
}

function dataDir(): string {
  const dir = process.env.AMBIGUITY_PICK_DIR?.trim()
    || join(process.cwd(), 'data', 'ambiguity')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10)
}

export function buildAmbiguityPickEvent(opts: {
  sourceShipmentId: string
  humanChoiceShipmentId: string
  actorId: string
  criticReview?: CriticReview | null
}): AmbiguityPickEvent | null {
  const ma = opts.criticReview?.matchAmbiguity
  if (!ma?.candidates || ma.candidates.length < 2) return null
  const sug = ma.suggestion && !ma.suggestion.cannotDecide ? ma.suggestion.shipmentId : null
  return {
    type: 'human_pick',
    ts: new Date().toISOString(),
    sourceShipmentId: opts.sourceShipmentId,
    humanChoiceShipmentId: opts.humanChoiceShipmentId,
    actorId: opts.actorId,
    emailKey: ma.emailKey,
    candidateIds: ma.candidates.map((c) => c.shipmentId),
    suggestionShipmentId: sug,
    suggestionSource: ma.suggestion?.source ?? null,
    agreedWithSuggestion: sug != null ? sug === opts.humanChoiceShipmentId : null,
  }
}

export function appendAmbiguityPick(event: AmbiguityPickEvent): void {
  try {
    const path = join(dataDir(), `picks-${utcDay()}.jsonl`)
    appendFileSync(path, `${JSON.stringify(event)}\n`, 'utf8')
  } catch {
    // best-effort — never fail the human link action
  }
}

export function logAmbiguityPickFromLink(opts: {
  sourceShipmentId: string
  humanChoiceShipmentId: string
  actorId: string
  criticReview?: CriticReview | null
}): void {
  const event = buildAmbiguityPickEvent(opts)
  if (!event) return
  appendAmbiguityPick(event)
  const agree =
    event.agreedWithSuggestion == null
      ? 'n/a'
      : event.agreedWithSuggestion
        ? 'agree'
        : 'disagree'
  // scrape-friendly one-liner
  console.info(
    `[ambiguity-pick] source=${event.sourceShipmentId} choice=${event.humanChoiceShipmentId} ` +
      `sug=${event.suggestionShipmentId ?? 'none'} ${agree} n=${event.candidateIds?.length ?? 0}`,
  )
}
