import { sqlErrorNumber } from './db-exception.filter'

/** SQL Server: 2627 = PK/unique CONSTRAINT violation, 2601 = unique INDEX violation. */
const UNIQUE_VIOLATION_NUMBERS = new Set([2627, 2601])

/**
 * True when an error is a unique/PK violation — i.e. a concurrent writer won the race.
 *
 * Callers use this to make check-then-insert paths race-safe: catch, then either re-SELECT the
 * winner's row (insert-or-get) or retry with a fresh key (sequence generators). Prefers the driver's
 * numeric code (via {@link sqlErrorNumber}, which unwraps tedious' nested `originalError`), and falls
 * back to message matching for wrapped/rethrown errors that lost their number.
 *
 * Replaces the ad-hoc `/unique|duplicate/i.test(...)` checks scattered across the repositories.
 */
export function isUniqueViolation(e: unknown): boolean {
  const n = sqlErrorNumber(e)
  if (n != null) return UNIQUE_VIOLATION_NUMBERS.has(n)
  return /unique|duplicate key/i.test(e instanceof Error ? e.message : String(e))
}
