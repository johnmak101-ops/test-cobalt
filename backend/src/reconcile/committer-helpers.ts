/**
 * Pure, stateless field helpers extracted from committer.service.ts (which had grown into a ~700-LOC
 * god file). No I/O — each is a small deterministic transform applied while building a shipment for commit.
 */

/** Dedupe a comma-joined list (order-preserving, case-insensitive) — style/HTS lists pile up across the
 *  multiple PO sheets + B/L rider, so the same value repeats. Applied at commit so it holds without a reparse. */
export const dedupeCsv = (s: string | null): string | null => {
  if (!s || !s.includes(',')) return s
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of s.split(',').map((x) => x.trim()).filter(Boolean)) {
    const k = t.toUpperCase()
    if (!seen.has(k)) {
      seen.add(k)
      out.push(t)
    }
  }
  return out.length ? out.join(',') : s
}

/** The ocean carrier SCAC is the leading 4 letters of the MASTER B/L (MEDUP5180997 -> MEDU = MSC). A
 *  deterministic backstop for when the model didn't emit scac_code; SCAC is stored as-is (no master check). */
export const scacFromMbl = (mbl: string | null): string | null => {
  // Carrier-BL shape = 4 letters immediately followed by an ALPHANUMERIC (a contiguous carrier token):
  // MEDUP5180997 -> MEDU, MAEU5123456 -> MAEU. The follow char may be a LETTER (MSC's 'MEDU'+'P...'), so it is
  // NOT required to be a digit — that earlier over-tightening dropped valid MSC SCACs. A separator-bearing
  // house routing ref like 'HUN-HKG-FXT-...' still yields null (only 3 letters before the '-').
  const m = /^([A-Z]{4})[A-Z0-9]/.exec((mbl ?? '').toUpperCase())
  return m ? m[1] : null
}

/** Origin countries spelled out in a free-text POL (e.g. "SHAHAJALAL INTL. AIR PORT, BANGLADESH") →
 *  ISO-2. Only used as a last-resort origin_country backstop when the port itself doesn't resolve.
 *  Keys are UPPERCASE; callers uppercase the extracted country tail before lookup. */
const COUNTRY_TO_ISO2: Record<string, string> = {
  BANGLADESH: 'BD', CHINA: 'CN', CAMBODIA: 'KH', VIETNAM: 'VN', INDIA: 'IN', INDONESIA: 'ID',
  THAILAND: 'TH', PAKISTAN: 'PK', 'SRI LANKA': 'LK', TURKEY: 'TR', MYANMAR: 'MM', 'HONG KONG': 'HK',
  TAIWAN: 'TW', 'SOUTH KOREA': 'KR', KOREA: 'KR', JAPAN: 'JP', PHILIPPINES: 'PH', MALAYSIA: 'MY',
}

/** ISO-2 for a spelled-out origin country (exact, UPPERCASE key), or null when unknown. */
export const countryToIso2 = (name: string): string | null => COUNTRY_TO_ISO2[name] ?? null
