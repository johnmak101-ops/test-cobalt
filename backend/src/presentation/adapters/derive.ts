/**
 * Derived UI fields the flat shape needs but the leg row doesn't store directly.
 * Pure functions — no DB access; the caller passes already-loaded values.
 */

/**
 * "POL→POD" route string from the two port identifiers (unlocode or short code). Always shows BOTH sides:
 * when one end is missing, a "-" placeholder fills it (`CNSZX → -` / `- → USLAX`) so the value reads as a
 * route rather than a lone code (#115). Both-present stays the compact `POL→POD`; neither → null (the UI
 * renders its own "—" dash). NB: consumers that split this back into cells must treat "-" as empty — see
 * splitRoute in PurchaseOrdersPage.
 */
/**
 * The multi-stop route string from a stored journey chain (`shipments.journey`, JSON) — `PVG→DEL→LHR`
 * instead of the endpoints-only `PVG→LHR`. Null unless the JSON parses to 2+ chained legs, so every
 * caller can fall back to deriveRoute() and a malformed or absent journey changes nothing. Stops are
 * displayed AS EXTRACTED: every one of them survived the queue's visibility guard (it appears in the
 * email that stated it), which is precisely why they are trustworthy enough to show.
 */
export function journeyRoute(journey: unknown): string | null {
  if (!journey) return null
  // 🔴 NEVER assume the wire type. The column is nvarchar JSON, but the kysely layer's JSON-parsing
  // plugin hands it back ALREADY PARSED as an array — the unit spec (string in) was green while the
  // integration test read null from a real row. Fourth sighting of this exact trap; accept both shapes.
  let legs: { pol?: unknown; pod?: unknown }[]
  if (Array.isArray(journey)) {
    legs = journey as { pol?: unknown; pod?: unknown }[]
  } else {
    try {
      const parsed = JSON.parse(String(journey)) as unknown
      if (!Array.isArray(parsed)) return null
      legs = parsed as { pol?: unknown; pod?: unknown }[]
    } catch {
      return null
    }
  }
  if (legs.length < 2) return null
  const stops = [String(legs[0]?.pol ?? ''), ...legs.map((l) => String(l?.pod ?? ''))].filter(Boolean)
  return stops.length >= 3 ? stops.join('→') : null
}

export function deriveRoute(
  pol: string | null | undefined,
  pod: string | null | undefined,
): string | null {
  if (!pol && !pod) return null
  if (pol && pod) return `${pol}→${pod}`
  return `${pol ?? '-'} → ${pod ?? '-'}`
}

/** The port code a leg should DISPLAY: AIR legs show the IATA airport code (CNCAN → CAN, the code
 *  air waybills and flight schedules use); sea legs keep the UN/LOCODE. Falls back to the
 *  UN/LOCODE when the airport's IATA code is unknown. */
export function portLabel(
  mode: string | null | undefined,
  unlocode: string | null | undefined,
  iata: string | null | undefined,
): string | null {
  if (mode === 'AIR' && iata) return iata
  return unlocode ?? null
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
