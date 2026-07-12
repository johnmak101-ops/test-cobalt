/**
 * Email disposition (matcher gates review, not the parser) — pure rules used by DecisionsService.
 *
 * Policy (from ShipTrack TODO / cobalt-email-disposition):
 *   - New PO + known customer → auto (unless a review signal fires)
 *   - New customer / mode-change / moved-shipment / late-PO / dup-number → review
 *   - No status update and no actionable identity → 不需處理 (skip: store path, no human review, no commit)
 *
 * Agent may send `disposition` / `autoApply` already; this module is the track-side authority for
 * *lookup-context* signals and for deriving disposition when the agent omits it.
 */
import type { CreateDecisionDto } from './dto'

const STRONG = ['so_no', 'booking_no', 'hbl_awb_fcr_no', 'mbl', 'container_no'] as const
const present = (v: unknown) => v != null && v !== ''
const hasStrong = (mk: Record<string, unknown> | undefined) => STRONG.some((k) => present(mk?.[k]))

/** Cross-leg / identity signals the agent attaches so track can gate without a full DB lookup. */
export interface LookupContext {
  knownCustomer?: boolean
  newCustomer?: boolean
  modeChange?: boolean
  movedShipment?: boolean
  latePo?: boolean
  duplicateNumber?: boolean
  /** Explicit status/milestone update present in the email (ETD/ETA/ATD/ATA/in_dc/etc.). */
  statusUpdate?: boolean
}

export type Disposition = 'auto' | 'review' | 'skip'

export interface DispositionResult {
  disposition: Disposition
  reasons: string[]
}

const REVIEW_SIGNALS: { key: keyof LookupContext; reason: string }[] = [
  { key: 'newCustomer', reason: 'the customer is new or not recognized' },
  { key: 'modeChange', reason: 'transport switched between sea and air' },
  { key: 'movedShipment', reason: 'the shipment was moved or reassigned' },
  { key: 'latePo', reason: 'a purchase order was added late to an existing shipment' },
  { key: 'duplicateNumber', reason: 'the same reference number already belongs to another shipment' },
]

/**
 * Resolve 3-way disposition from the decision payload + optional lookup context.
 * Pure — no I/O. Prefer explicit dto.disposition when set; still escalate to review when a
 * lookup review-signal is present (safe direction only).
 */
export function resolveEmailDisposition(dto: CreateDecisionDto): DispositionResult {
  const ctx: LookupContext = dto.lookupContext ?? {}
  const reasons: string[] = []

  // Review signals always escalate (even if the agent said auto).
  for (const s of REVIEW_SIGNALS) {
    if (ctx[s.key] === true) reasons.push(s.reason)
  }
  if (reasons.length) return { disposition: 'review', reasons }

  // Explicit agent disposition after review-signal check.
  if (dto.disposition === 'skip' || dto.disposition === 'auto' || dto.disposition === 'review') {
    return { disposition: dto.disposition, reasons: dto.reviewReasons ?? [] }
  }

  const pos = dto.pos ?? []
  const mk = dto.matchKey ?? {}
  const hasPo = pos.length > 0
  const strong = hasStrong(mk)
  const statusUpdate = ctx.statusUpdate === true
  const knownCustomer = ctx.knownCustomer === true

  // 不需處理: no PO, no strong id, no status update — not actionable as a shipment commit.
  if (!hasPo && !strong && !statusUpdate) {
    return {
      disposition: 'skip',
      reasons: ['no PO / strong id / status update — not actionable (不需處理)'],
    }
  }

  // New PO + known customer → auto (identity or status may still be sparse early).
  if (hasPo && knownCustomer) {
    return { disposition: 'auto', reasons: [] }
  }

  // Has PO but customer not known as existing → review.
  if (hasPo && ctx.knownCustomer === false) {
    return { disposition: 'review', reasons: ['PO present but customer not known'] }
  }

  // Strong identity without review signals → auto when agent omitted disposition.
  if (strong) return { disposition: 'auto', reasons: [] }

  // Status-only update without identity → still auto if statusUpdate (amend path); else review.
  if (statusUpdate) return { disposition: 'auto', reasons: [] }

  return { disposition: 'review', reasons: ['insufficient identity for auto-apply'] }
}
