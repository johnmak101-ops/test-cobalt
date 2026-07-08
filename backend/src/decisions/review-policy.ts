import type { CreateDecisionDto } from './dto'

/**
 * A named review trigger: an admin-legible condition that, when enabled and matched, forces a human
 * review (downgrades an auto-confirm to provisional). Pure — reads only the decision payload.
 * Governing a new trigger = append one entry; the API and Settings UI adapt automatically.
 */
export interface ReviewTrigger {
  id: string
  label: string
  predicate: (d: CreateDecisionDto) => boolean
}

const STRONG_KEYS = ['so_no', 'booking_no', 'hbl_awb_fcr_no', 'mbl', 'container_no']
const present = (v: unknown): boolean => v != null && v !== ''
const hasStrongKey = (matchKey: Record<string, unknown> | undefined): boolean =>
  STRONG_KEYS.some((k) => present(matchKey?.[k]))
const populatedFieldCount = (fields: Record<string, unknown> | undefined): number =>
  Object.values(fields ?? {}).filter(present).length

/** v1 catalog — every predicate reads only the decision payload, so these gate LIVE agent decisions. */
export const REVIEW_TRIGGERS: ReviewTrigger[] = [
  { id: 'conflict', label: "there's an unresolved conflict", predicate: (d) => (d.conflicts?.length ?? 0) > 0 },
  {
    id: 'no_strong_id',
    label: "there's no strong identity key (SO / booking / B-L / AWB / container)",
    predicate: (d) => !hasStrongKey(d.matchKey),
  },
  { id: 'no_po', label: 'no PO is linked', predicate: (d) => (d.pos?.length ?? 0) === 0 },
  { id: 'cancellation', label: "it's a cancellation notice", predicate: (d) => d.cancelled === true },
  {
    id: 'platform_only',
    label: "it's a platform-only notification (CVP / TradeLinkOne)",
    predicate: (d) => d.fromPlatform === true,
  },
  { id: 'sparse', label: 'the data is sparse (fewer than 2 populated fields)', predicate: (d) => populatedFieldCount(d.fields) < 2 },
]

export const REVIEW_TRIGGER_IDS = REVIEW_TRIGGERS.map((t) => t.id)

export interface ReviewPolicy {
  enabled: string[]
}

/** Labels of the enabled triggers whose predicate matches this decision (empty = nothing fires). */
export function evaluate(policy: ReviewPolicy, decision: CreateDecisionDto): string[] {
  const enabled = new Set(policy?.enabled ?? [])
  return REVIEW_TRIGGERS.filter((t) => enabled.has(t.id) && t.predicate(decision)).map((t) => t.label)
}

/** The full catalog joined with the enabled state — what the Settings UI renders. */
export function catalogView(enabled: string[]): { id: string; label: string; enabled: boolean }[] {
  const set = new Set(enabled ?? [])
  return REVIEW_TRIGGERS.map((t) => ({ id: t.id, label: t.label, enabled: set.has(t.id) }))
}
