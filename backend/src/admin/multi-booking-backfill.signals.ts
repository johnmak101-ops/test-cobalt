/** Pure Hybrid-C multi-booking mush detectors (no Nest/DB). */

export const BACKFILL_STAMP_REASON =
  'Hybrid-C multi-booking backfill — rematch recommended (re-run queue matcher on source email)'

export function detectMultiBookingMushSignals(opts: {
  reviewReasons: string[]
  bookingNo: string | null
  criticReview: Record<string, unknown> | null
}): string[] {
  const signals: string[] = []
  const reasons = opts.reviewReasons.map((r) => r.toLowerCase())
  if (
    reasons.some((r) =>
      /multi-booking split incomplete|distinct co-current|multi strong|ambiguous match|matched multiple/i.test(r),
    )
  ) {
    signals.push('review_reason')
  }
  if (reasons.some((r) => r.includes('hybrid-c multi-booking backfill'))) {
    signals.push('already_stamped')
  }
  const bk = (opts.bookingNo ?? '').trim()
  if (bk && /[,;&]| and /i.test(bk)) signals.push('concat_booking_no')
  const cr = opts.criticReview
  if (cr?.splitAudit) signals.push('split_audit')
  const ma = cr?.matchAmbiguity as { candidates?: unknown[] } | undefined
  if (ma?.candidates && ma.candidates.length >= 2) signals.push('match_ambiguity')
  return signals
}
