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

/** v1 catalog — every predicate reads only the decision payload, so these gate LIVE agent decisions.
 *  Labels are plain ops language (Settings UI + review queue). Keep IDs stable. */
export const REVIEW_TRIGGERS: ReviewTrigger[] = [
  {
    id: 'conflict',
    label: 'the email disagrees with what’s already on the shipment',
    predicate: (d) => (d.conflicts?.length ?? 0) > 0,
  },
  {
    id: 'no_strong_id',
    label: 'there’s no booking, bill of lading, AWB, or container number',
    predicate: (d) => !hasStrongKey(d.matchKey),
  },
  {
    id: 'no_po',
    label: 'there’s no purchase order',
    predicate: (d) => (d.pos?.length ?? 0) === 0,
  },
  {
    id: 'cancellation',
    label: 'the email is a cancellation',
    predicate: (d) => d.cancelled === true,
  },
  {
    id: 'platform_only',
    label: 'the email is only a portal alert (not a real booking update)',
    predicate: (d) => d.fromPlatform === true,
  },
  {
    id: 'sparse',
    label: 'the email has almost no useful shipment details',
    predicate: (d) => populatedFieldCount(d.fields) < 2,
  },
  // v2 lookup triggers — need agent-supplied lookupContext (cross-leg / master knowledge the payload alone lacks)
  {
    id: 'new_customer',
    label: 'the customer is new or not recognized',
    predicate: (d) => d.lookupContext?.newCustomer === true,
  },
  {
    id: 'mode_change',
    label: 'transport switched between sea and air',
    predicate: (d) => d.lookupContext?.modeChange === true,
  },
  {
    id: 'moved_shipment',
    label: 'the shipment was moved or reassigned',
    predicate: (d) => d.lookupContext?.movedShipment === true,
  },
  {
    id: 'duplicate_number',
    label: 'the same reference number already belongs to another shipment',
    predicate: (d) => d.lookupContext?.duplicateNumber === true,
  },
  {
    id: 'late_po',
    label: 'a purchase order was added late to an existing shipment',
    predicate: (d) => d.lookupContext?.latePo === true,
  },
  // Iterator residual (2026-07-12): optional gates for fields the soul/un-freeze often gets wrong.
  // Default OFF in seed policies — enable in Settings after measuring fire rate on live traffic.
  {
    id: 'brand_present',
    label: 'a brand was found (check it isn’t really the customer or style name)',
    predicate: (d) => present(d.fields?.brand),
  },
  {
    id: 'in_dc_date',
    label: 'a warehouse delivery date was found (check it isn’t a cut-off date)',
    predicate: (d) => present(d.fields?.in_dc_date),
  },
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
