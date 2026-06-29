/**
 * Derived UI fields the flat shape needs but the leg row doesn't store directly.
 * Pure functions — no DB access; the caller passes already-loaded values.
 */

/** "POL→POD" route string from the two port identifiers (unlocode or short code). */
export function deriveRoute(
  pol: string | null | undefined,
  pod: string | null | undefined,
): string | null {
  if (pol && pod) return `${pol}→${pod}`
  return pol || pod || null
}

/** Origin country (ISO) read off the POL port; null when unknown (Phase 1 — display only). */
export function deriveOriginCountry(
  polPort: { country?: string | null } | null | undefined,
): string | null {
  return polPort?.country ?? null
}

/** Date (or already-ISO string) -> ISO string for the UI; null/undefined -> null. */
export function isoOrNull(d: Date | string | null | undefined): string | null {
  if (d == null) return null
  return d instanceof Date ? d.toISOString() : String(d)
}

/** PO numbers (deduped, non-empty, first-seen order) as the JSON string the UI parses. */
export function poNumbersJson(poNumbers: Array<string | null | undefined>): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const po of poNumbers) {
    const v = (po ?? '').trim()
    if (v && !seen.has(v)) {
      seen.add(v)
      out.push(v)
    }
  }
  return JSON.stringify(out)
}
