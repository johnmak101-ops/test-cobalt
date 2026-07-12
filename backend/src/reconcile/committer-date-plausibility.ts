import { str, date } from './match-keys'

const DAY_MS = 86_400_000

/**
 * An ETD stated this many days BEFORE the shipment's earliest source email is treated as implausible.
 * Deliberately conservative: because only post-departure replies are often ingested (the booking-
 * ingestion gap), a small ETD-before-email gap is normal and must NOT be flagged — only a large one is.
 */
export const STALE_ETD_MIN_DAYS = 60

/**
 * Review reason when the stated ETD falls implausibly far BEFORE the shipment's own source emails —
 * i.e. the sender's departure date had already passed by more than STALE_ETD_MIN_DAYS days when the
 * FIRST email about the booking arrived. That is almost always a reused subject date or a wrong
 * month/year (see the WHIS MACFUN "24-Jan-2026" reused-subject case), not a real just-departed
 * shipment. Surfacing only (de-correction): the ETD value is kept; a reviewer verifies.
 *
 * The emitted string is the contract the frontend humanizer parses
 * (`sender: ETD <date> is <n> days before this email` — see review-reasons.ts). Returns [] when there
 * is no ETD, no usable email date, or the gap is within tolerance.
 */
export function staleEtdReasons(fields: Record<string, unknown>, events: { receivedAt: string }[]): string[] {
  const raw = str(fields.etd)
  const etd = date(fields.etd)
  if (!raw || !etd) return []
  const earliest = earliestReceivedAt(events)
  if (!earliest) return []
  const days = Math.floor((earliest.getTime() - etd.getTime()) / DAY_MS)
  if (days <= STALE_ETD_MIN_DAYS) return []
  return [`sender: ETD ${raw} is ${days} days before this email`]
}

/** Smallest (earliest) parseable `receivedAt` across the source emails — the most conservative reference
 *  point (a later reply can only enlarge the gap, never shrink it). Null when none parse. */
function earliestReceivedAt(events: { receivedAt: string }[]): Date | null {
  let min: Date | null = null
  for (const e of events) {
    const d = new Date(e.receivedAt)
    if (Number.isNaN(d.getTime())) continue
    if (!min || d < min) min = d
  }
  return min
}
