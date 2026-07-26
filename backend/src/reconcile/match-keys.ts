/** Match-key handling + small coercions used across reconciliation. */

export const normKey = (v: unknown): string => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/** A bare ≤3-significant-digit numeric token ('001', '12', '156', '00000156') is a line/row/sequence
 *  number lifted from a tabular invoice, never a real booking/SO/HBL. Keep in sync with
 *  cobalt-queue match-keys.ts. Used by mergeShipment to drop over-merge bait from identity slots. */
export const isSequenceToken = (v: unknown): boolean => /^0*\d{1,3}$/.test(String(v ?? '').trim())

/** A re-issued booking carries a revision suffix ('BX845666 V3', 'BX845666-REV2', 'BX845666 AMENDED') — the
 *  SAME booking. Strip a SEPARATOR-delimited trailing revision marker so a revision amends rather than spawns
 *  a duplicate. Must stay identical to the matcher's copy (cobalt-queue match-keys.ts) so commit-time match
 *  == matcher lookup. booking_no ONLY. */
export const normBookingKey = (v: unknown): string => {
  const raw = String(v ?? '').toUpperCase().trim()
  const base = raw.replace(/[\s\-/]+(?:V|R|REV|AMD|AMEND(?:ED)?|REVISION)\s*\d*$/, '')
  return normKey(base)
}

/**
 * `A26050003` and `SZA26050003` are the SAME air waybill — one forwarder writes the bare-`A` form in the
 * email SUBJECT (`BL#A26050003 ELGC// …`) while the B/L attachment itself says `SZA26050003`. Collapse to the
 * `SZA` form. Must stay identical to the matcher's copy (cobalt-queue `parser/identity-tokens.ts`
 * `normalizeAwbToken`) for the same reason `normBookingKey` must: commit-time match == matcher lookup.
 * hbl_awb_fcr_no ONLY.
 *
 * 🔴 Without this, plain `normKey` made `hbl:A26050003` and `hbl:SZA26050003` two different keys, so a
 * decision carrying the long form could not find a leg committed under the short one — measured live on
 * 2026-07-26: the committer missed JOB-2026-0003 and minted duplicate JOB-2026-0010 for the same shipment,
 * while cobalt-queue's own binding matched it correctly (via the MBL). Returns null when the token is too
 * short to judge, so callers fall back to `normKey` rather than dropping the identity.
 */
export const normAwbKey = (v: unknown): string | null => {
  if (v == null || v === '') return null
  const u = String(v)
    .toUpperCase()
    .replace(/^BL#\s*/i, '')
    .replace(/[^A-Z0-9]/g, '')
  if (!u) return null
  const sza = u.match(/^SZA(\d{6,})$/)
  if (sza) return `SZA${sza[1]}`
  const aOnly = u.match(/^A(\d{6,})$/) // the subject form
  if (aOnly) return `SZA${aOnly[1]}`
  if (/^(GZL|SNZ|SZA)\d+$/.test(u)) return u
  if (/^S\d{8,}$/.test(u)) return u
  return u.length >= 4 ? u : null
}

/** Strong, rotation-resistant identifiers a leg can be matched on (NOT customer_po alone). */
const STRONG = ['so_no', 'booking_no', 'hbl_awb_fcr_no', 'mbl', 'container_no'] as const

/**
 * The ONE normalizer per key type. `matchKeyIndexRows` derives the persisted `shipment_match_keys` rows from
 * this same function, so a change here moves the query side AND the stored index together — but rows written
 * BEFORE the change keep their old value until re-derived.
 */
const normForKey = (k: (typeof STRONG)[number], v: unknown): string =>
  k === 'booking_no' ? normBookingKey(v) : k === 'hbl_awb_fcr_no' ? (normAwbKey(v) ?? normKey(v)) : normKey(v)

export function strongKeys(mk: Record<string, unknown> | null | undefined): Set<string> {
  const s = new Set<string>()
  if (!mk) return s
  for (const k of STRONG) {
    const v = normForKey(k, mk[k])
    if (v) s.add(`${k}:${v}`)
  }
  return s
}

export function keysOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const k of a) if (b.has(k)) return true
  return false
}

/** Union the bag of match_keys across a group's rows (first non-empty wins per key). */
export function mergeKeys(rows: { matchKeys: Record<string, unknown> | null }[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of ['customer_po', 'so_no', 'booking_no', 'hbl_awb_fcr_no', 'mbl', 'conversation_id']) {
    for (const r of rows) {
      const v = r.matchKeys?.[k]
      if (v != null && v !== '') {
        out[k] = v
        break
      }
    }
  }
  return out
}

// ---- coercions from extracted (string) fields to typed columns ----
export const str = (v: unknown): string | null => {
  const s = v == null ? '' : String(v).trim()
  return s === '' ? null : s
}
export const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const cleaned = String(v).replace(/[^0-9.-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null // e.g. 'abc' -> '' (Number('') is 0!)
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}
export const date = (v: unknown): Date | null => {
  const s = str(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}
