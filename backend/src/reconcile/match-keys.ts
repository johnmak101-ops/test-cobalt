/** Match-key handling + small coercions used across reconciliation. */

export const normKey = (v: unknown): string => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/** A re-issued booking carries a revision suffix ('BX845666 V3', 'BX845666-REV2', 'BX845666 AMENDED') — the
 *  SAME booking. Strip a SEPARATOR-delimited trailing revision marker so a revision amends rather than spawns
 *  a duplicate. Must stay identical to the matcher's copy (cobalt-queue match-keys.ts) so commit-time match
 *  == matcher lookup. booking_no ONLY. */
export const normBookingKey = (v: unknown): string => {
  const raw = String(v ?? '').toUpperCase().trim()
  const base = raw.replace(/[\s\-/]+(?:V|R|REV|AMD|AMEND(?:ED)?|REVISION)\s*\d*$/, '')
  return normKey(base)
}

/** Strong, rotation-resistant identifiers a leg can be matched on (NOT customer_po alone). */
const STRONG = ['so_no', 'booking_no', 'hbl_awb_fcr_no', 'mbl', 'container_no'] as const

export function strongKeys(mk: Record<string, unknown> | null | undefined): Set<string> {
  const s = new Set<string>()
  if (!mk) return s
  for (const k of STRONG) {
    const v = k === 'booking_no' ? normBookingKey(mk[k]) : normKey(mk[k])
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
