/**
 * The calendar day of a leg date column, in the app's own timezone.
 *
 * Leg dates are naive wall-clock values: the UI sends "2026-07-08T00:00", the backend runs with
 * TZ pinned (docker-compose: `TZ: ${TZ:-Asia/Hong_Kong}`), and `new Date()` mints the instant for
 * local midnight. Stored as UTC that is `2026-07-07T16:00:00Z` — the PREVIOUS calendar day.
 *
 * So `d.toISOString().slice(0, 10)` returns the wrong day for every date-only column: a cargo-ready
 * date of the 8th reads back as the 7th. That is invisible in a comparison where both sides shift
 * equally, and very visible the moment the string reaches an operator or is frozen for a later
 * equality check.
 *
 * This reads the LOCAL components instead, which is the same wall-clock day the operator picked and
 * the same day the UI renders.
 */
export function legDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
