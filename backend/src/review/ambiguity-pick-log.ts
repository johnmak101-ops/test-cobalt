/**
 * #129 Phase F / #173 A′ — log human multi-candidate picks (no full email body).
 * Appends under AMBIGUITY_PICK_DIR or data/ambiguity/picks-YYYY-MM-DD.jsonl.
 */
import { appendFile, mkdir } from 'node:fs/promises'
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
  /** 0-based index of suggestion in candidate list (anchoring measure, #173 A′). */
  suggestionDisplayPosition?: number | null
  /** Join back to provisional / decision context. */
  decisionRef?: string | null
  /** true when human picked the same id as suggestion */
  agreedWithSuggestion: boolean | null
}

async function dataDir(): Promise<string> {
  const dir = process.env.AMBIGUITY_PICK_DIR?.trim()
    || join(process.cwd(), 'data', 'ambiguity')
  await mkdir(dir, { recursive: true })
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
  const ma = opts.criticReview?.matchAmbiguity as {
    candidates?: { shipmentId: string }[]
    emailKey?: Record<string, string>
    suggestion?: { shipmentId: string; source?: string; cannotDecide?: boolean }
    llmSuggestion?: { shipmentId: string; source?: string; cannotDecide?: boolean }
  } | undefined
  if (!ma?.candidates || ma.candidates.length < 2) return null
  const ids = ma.candidates.map((c) => c.shipmentId)
  const sugObj =
    ma.suggestion && !ma.suggestion.cannotDecide
      ? ma.suggestion
      : ma.llmSuggestion && !ma.llmSuggestion.cannotDecide
        ? ma.llmSuggestion
        : null
  const sug = sugObj?.shipmentId ?? null
  const pos = sug ? ids.indexOf(sug) : -1
  return {
    type: 'human_pick',
    ts: new Date().toISOString(),
    sourceShipmentId: opts.sourceShipmentId,
    humanChoiceShipmentId: opts.humanChoiceShipmentId,
    actorId: opts.actorId,
    emailKey: ma.emailKey,
    candidateIds: ids,
    suggestionShipmentId: sug,
    suggestionSource: sugObj?.source ?? null,
    suggestionDisplayPosition: pos >= 0 ? pos : null,
    decisionRef: opts.sourceShipmentId,
    agreedWithSuggestion: sug != null ? sug === opts.humanChoiceShipmentId : null,
  }
}

export async function appendAmbiguityPick(event: AmbiguityPickEvent): Promise<void> {
  if (process.env.AMBIGUITY_PICK_JSONL === '0' || process.env.AMBIGUITY_PICK_JSONL === 'false') return
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') return
  try {
    const path = join(await dataDir(), `picks-${utcDay()}.jsonl`)
    await appendFile(path, `${JSON.stringify(event)}\n`, 'utf8')
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
  void appendAmbiguityPick(event)
  const agree =
    event.agreedWithSuggestion == null
      ? 'n/a'
      : event.agreedWithSuggestion
        ? 'agree'
        : 'disagree'
  console.info(
    `[ambiguity-pick] source=${event.sourceShipmentId} choice=${event.humanChoiceShipmentId} ` +
      `sug=${event.suggestionShipmentId ?? 'none'} src=${event.suggestionSource ?? '-'} ` +
      `pos=${event.suggestionDisplayPosition ?? '-'} ${agree} n=${event.candidateIds?.length ?? 0}`,
  )
}
