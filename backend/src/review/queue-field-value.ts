import { DATE_FIELDS } from '../shipments/coerce-field'
import { legDay } from '../common/leg-day'

/**
 * The value a leg column contributes to the queue learning feed (POST /review/correction), in the
 * PARSER's own format — because the queue scores by comparing this string against what a re-parse
 * produces, so any formatting difference is a permanent, silent miss.
 *
 * Dates are the whole reason this exists. A leg date is a `Date`, and `String(d)` / `d.toISOString()`
 * yields `2026-05-08T00:00:00.000Z` while the parser emits `2026-05-08`. Those never compare equal, so
 * every date correction became fuel that could not burn: it counted toward the queue's batch trigger,
 * taught the refiner a format no parse can produce, and scored as a guaranteed miss for BOTH the
 * baseline and candidate soul on the held-out split — the same failure the `QUEUE_FIELD_ALIAS` map
 * above `applyHumanFieldWrite` was introduced to end, one layer down (value instead of field name).
 *
 * The confirm path already did this via its own `confirmValue`; corrections did not. This is that
 * function, promoted to the one definition both paths share, keyed off `DATE_FIELDS` so the date list
 * cannot drift from the coercion that produced the Date in the first place.
 *
 * Day granularity is deliberate even for columns that carry a time (`cfsCutoff`, the warehouse window):
 * the parser emits days, and a comparison is only useful at the granularity both sides can express.
 *
 * `legDay` (not a UTC slice) because leg dates are naive local wall-clock stored as UTC — slicing the
 * ISO string returns the PREVIOUS day for anything east of Greenwich.
 */
export function queueLearningValue(column: string, value: unknown): string | null {
  if (value == null || value === '') return null
  if (DATE_FIELDS.has(column) || value instanceof Date) {
    const d = value instanceof Date ? value : new Date(String(value))
    return Number.isNaN(d.getTime()) ? null : legDay(d)
  }
  return String(value)
}
